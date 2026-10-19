import { MapView } from "./MapView";
import { Sidebar } from "./Sidebar";
import { useWorldSocket } from "./useWorldSocket";

export function App() {
  const world = useWorldSocket();
  return (
    <div className="layout">
      <Sidebar world={world} />
      <main className="map-area">
        <MapView cities={world.cities} state={world.state} />
      </main>
    </div>
  );
}
