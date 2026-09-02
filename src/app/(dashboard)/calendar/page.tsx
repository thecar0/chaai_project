import CalendarView from "@/components/calendar/CalendarView";

export default function CalendarPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">캘린더</h1>
      <CalendarView />
    </div>
  );
}
