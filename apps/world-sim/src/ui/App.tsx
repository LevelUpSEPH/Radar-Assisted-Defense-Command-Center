import { MapView } from "./MapView";
import { Sidebar } from "./Sidebar";
import { useWorldSocket } from "./useWorldSocket";

export function App() {
  const world = useWorldSocket();
  return (
    <div className="layout">
      <Sidebar world={world} />
      <main className="map-area">
        <MapView view={world.view} state={world.state} />
      </main>
    </div>
  );
}
