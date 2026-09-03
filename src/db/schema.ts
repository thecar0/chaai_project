import {
  pgTable,
  serial,
  text,
  varchar,
  timestamp,
  date,
  integer,
  boolean,
  doublePrecision,
  pgEnum,
  index,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

export const inspectionTypeEnum = pgEnum("inspection_type", [
  "operational", // 작동점검
  "comprehensive", // 종합점검
]);

export const inspectionStatusEnum = pgEnum("inspection_status", [
  "scheduled",
  "completed",
  "overdue",
  "canceled",
]);

export const userRoleEnum = pgEnum("user_role", ["admin", "user"]);

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  email: varchar("email", { length: 255 }).notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  name: varchar("name", { length: 100 }).notNull(),
  role: userRoleEnum("role").default("user").notNull(),
  isActive: boolean("is_active").default(true).notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// 점검팀 - 건물 수가 많아지면 인원을 3~5명 단위 소규모 팀으로 나눠서 각자
// 담당 건물만 돌게 하는 게 현장에서 더 효율적이라(거리·규모 고려), 계정(회사)
// 하나 아래에 팀을 여러 개 두고 건물마다 담당 팀을 지정한다. 로그인 계정은
// 지금처럼 회사에 1개 그대로이고(팀별 로그인 분리는 아님), 팀은 어디까지나
// 같은 계정 안에서 건물을 나눠 보고 나눠 배치하기 위한 분류다.
export const teams = pgTable(
  "teams",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    name: varchar("name", { length: 100 }).notNull(),
    // 이 팀의 기본 기술인력 인원수 - 배치 계산의 하루 한도 산정에 쓰인다. 매번
    // 입력하지 않아도 되도록 팀 관리에서 한 번 정해두고 배치 때는 이 값을 쓴다.
    personnelCount: integer("personnel_count").default(3).notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("teams_user_id_idx").on(table.userId),
  })
);

// 건축물대장에서 옮겨오는 핵심 필드
export const buildings = pgTable(
  "buildings",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
    // 담당 팀 - 미배정(null) 허용. 팀이 삭제돼도 건물은 남아야 하므로 set null.
    teamId: integer("team_id").references(() => teams.id, { onDelete: "set null" }),
    // true면 이 teamId는 사용자가 직접 정한 게 아니라 "전체 배치"의 거리 기준
    // 자동 배정이 붙여준 것 - 다음 배치 때 그 팀이 넘치면 다른 팀으로 다시
    // 옮겨질 수 있는 "느슨한" 배정이다. 사용자가 건물 목록/수정 화면·엑셀
    // 담당팀 등으로 직접 지정하면 false(고정)가 된다.
    teamAssignedAuto: boolean("team_assigned_auto").default(false).notNull(),
    name: varchar("name", { length: 255 }).notNull(), // 건축물명
    // 대지위치/도로명주소 - 실제 주소를 모르는 경우(예: 엑셀에 주소 없이 이름만 있는
    // 행) null로 두고, 나중에 "주소 채우기"에서 건축물명으로 검색해 채워 넣는다.
    address: varchar("address", { length: 500 }),
    buildingType: varchar("building_type", { length: 100 }).notNull(), // 주용도 (근린생활시설, 공동주택 등)
    totalFloorAreaM2: integer("total_floor_area_m2"), // 연면적(㎡)
    floorCount: integer("floor_count"), // 지상 층수
    // 사용승인일 - 점검주기 산정 기준일. 실제 사용승인일을 모르는 경우(예: 시트명이
    // "01월"~"12월"인 반복점검 목록 엑셀)에는 null로 두고 recurringInspectionMonth만 쓴다.
    useApprovalDate: date("use_approval_date", { mode: "string" }),
    // 사용승인일 대신 "매년 이 달에 반복 점검"만 아는 경우의 점검월(1~12).
    recurringInspectionMonth: integer("recurring_inspection_month"),
    fireSafetyGrade: varchar("fire_safety_grade", { length: 50 }), // 소방안전관리대상물 등급 (특급/1급/2급/3급 등, 추후 확정)
    notes: text("notes"),

    // 점검인력 배치 계산용 (전부 nullable = "정보 없음" → 불리하게 추정하지 않고 감액 없이 계산)
    hasSprinkler: boolean("has_sprinkler"), // 스프링클러 설치 여부
    hasWaterSpray: boolean("has_water_spray"), // 물분무등소화설비 설치 여부
    hasSmokeControl: boolean("has_smoke_control"), // 제연설비 설치 여부
    isMultiUseBusiness: boolean("is_multi_use_business"), // 다중이용업 포함 여부 (작동점검 0.8 배수 판정)
    isApartment: boolean("is_apartment"), // 아파트(세대수 기준 계산) 여부
    unitCount: integer("unit_count"), // 세대수 (아파트인 경우)
    isPerformanceDesign: boolean("is_performance_design"), // 성능위주설계 대상 여부 (인력배치기준 분기)
    latitude: doublePrecision("latitude"), // 주행거리 계산용 좌표 캐시
    longitude: doublePrecision("longitude"),

    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    userIdIdx: index("buildings_user_id_idx").on(table.userId),
    teamIdIdx: index("buildings_team_id_idx").on(table.teamId),
  })
);

export const inspectionSchedules = pgTable(
  "inspection_schedules",
  {
    id: serial("id").primaryKey(),
    buildingId: integer("building_id")
      .references(() => buildings.id, { onDelete: "cascade" })
      .notNull(),
    inspectionType: inspectionTypeEnum("inspection_type").notNull(),
    scheduledDate: date("scheduled_date", { mode: "string" }).notNull(),
    // scheduledDate(시작일)부터 평일 기준 며칠에 걸쳐 진행되는지. 보통 1이고,
    // 혼자서도 하루 점검 한도를 넘는 큰 건물만 배치 엔진이 1보다 크게 채운다.
    durationDays: integer("duration_days").default(1).notNull(),
    status: inspectionStatusEnum("status").default("scheduled").notNull(),
    // 사용자가 직접 날짜를 지정(이월)한 건 - 자동 인력 배치 대상에서 제외한다.
    isManuallyScheduled: boolean("is_manually_scheduled").default(false).notNull(),
    completedAt: timestamp("completed_at"),
    notes: text("notes"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    buildingIdIdx: index("inspection_schedules_building_id_idx").on(table.buildingId),
    scheduledDateIdx: index("inspection_schedules_scheduled_date_idx").on(
      table.scheduledDate
    ),
  })
);

// 실제 주행거리 API 결과 캐시 - 배치 미리보기를 다시 돌릴 때마다(인원수 바꿔서
// 재시도 등) 같은 두 건물 쌍의 거리를 매번 다시 조회하면 느려지므로 한 번 구한
// 값은 재사용한다. buildingIdA < buildingIdB로 정규화해서 저장(순서 무관하게 한 쌍당 1행).
export const drivingDistances = pgTable(
  "driving_distances",
  {
    id: serial("id").primaryKey(),
    buildingIdA: integer("building_id_a")
      .references(() => buildings.id, { onDelete: "cascade" })
      .notNull(),
    buildingIdB: integer("building_id_b")
      .references(() => buildings.id, { onDelete: "cascade" })
      .notNull(),
    distanceKm: doublePrecision("distance_km").notNull(),
    durationMinutes: doublePrecision("duration_minutes").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (table) => ({
    pairIdx: uniqueIndex("driving_distances_pair_idx").on(table.buildingIdA, table.buildingIdB),
  })
);

export const usersRelations = relations(users, ({ many }) => ({
  buildings: many(buildings),
  teams: many(teams),
}));

export const teamsRelations = relations(teams, ({ one, many }) => ({
  owner: one(users, {
    fields: [teams.userId],
    references: [users.id],
  }),
  buildings: many(buildings),
}));

export const buildingsRelations = relations(buildings, ({ one, many }) => ({
  owner: one(users, {
    fields: [buildings.userId],
    references: [users.id],
  }),
  team: one(teams, {
    fields: [buildings.teamId],
    references: [teams.id],
  }),
  inspections: many(inspectionSchedules),
}));

export const inspectionSchedulesRelations = relations(
  inspectionSchedules,
  ({ one }) => ({
    building: one(buildings, {
      fields: [inspectionSchedules.buildingId],
      references: [buildings.id],
    }),
  })
);
