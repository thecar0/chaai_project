import BuildingForm from "@/components/buildings/BuildingForm";

export default function NewBuildingPage() {
  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold tracking-tight">건축물대장 등록</h1>
      <BuildingForm />
    </div>
  );
}
