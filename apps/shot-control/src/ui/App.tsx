import { MapView } from "./MapView";
import { Sidebar } from "./Sidebar";
import { useWeaponSocket } from "./useWeaponSocket";

export function App() {
  const weapon = useWeaponSocket();
  return (
    <div className="layout">
      <Sidebar weapon={weapon} />
      <main className="map-area">
        <MapView state={weapon.state} />
      </main>
    </div>
  );
}
