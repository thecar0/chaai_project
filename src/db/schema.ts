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

// 건축물대장에서 옮겨오는 핵심 필드
export const buildings = pgTable(
  "buildings",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .references(() => users.id, { onDelete: "cascade" })
      .notNull(),
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

export const usersRelations = relations(users, ({ many }) => ({
  buildings: many(buildings),
}));

export const buildingsRelations = relations(buildings, ({ one, many }) => ({
  owner: one(users, {
    fields: [buildings.userId],
    references: [users.id],
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
