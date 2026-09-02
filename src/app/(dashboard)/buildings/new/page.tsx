import BuildingForm from "@/components/buildings/BuildingForm";
import BackButton from "@/components/BackButton";

export default function NewBuildingPage() {
  return (
    <div className="flex flex-col gap-6">
      <BackButton href="/buildings" />
      <h1 className="text-2xl font-semibold tracking-tight">건축물대장 등록</h1>
      <BuildingForm />
    </div>
  );
}
