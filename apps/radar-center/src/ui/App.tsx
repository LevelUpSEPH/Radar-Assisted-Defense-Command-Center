import { MapView } from "./MapView";
import { Sidebar } from "./Sidebar";
import { useRadarSocket } from "./useRadarSocket";

export function App() {
  const radar = useRadarSocket();
  return (
    <div className="layout">
      <Sidebar radar={radar} />
      <main className="map-area">
        <MapView state={radar.state} disabled={!radar.connected} send={radar.send} />
      </main>
    </div>
  );
}
