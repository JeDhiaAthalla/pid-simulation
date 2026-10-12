import { ROBOTS, RobotType } from '../types/robots';
import { computeRobotCamera, RobotCameraState, ARCHETYPE_ANCHORS } from '../components/SimulationCanvas';

interface ArchetypeCamTest {
  robotId: string;
  name: string;
  viewport: string;
  w: number;
  h: number;
  // Center check at Reset View
  camFocalX: number;
  camFocalY: number;
  targetX: number;
  targetY: number;
  camDeltaX: number;
  camDeltaY: number;
  // Actual drawn robot focal point (from drawing function logic)
  drawnRobotX: number;
  drawnRobotY: number;
  drawnDeltaX: number;
  drawnDeltaY: number;
  isDrawnCentered: boolean;
  // Margins after extreme 4-way pan
  panLeftMargin: number;
  panRightMargin: number;
  panTopMargin: number;
  panBottomMargin: number;
}

function getDrawnRobotCoords(robotId: string, w: number, h: number, pv: number = 0): { x: number; y: number } {
  const anchor = ARCHETYPE_ANCHORS[robotId as RobotType] ?? { dx: 0, dy: 0 };
  return { x: w / 2 + anchor.dx, y: h / 2 + anchor.dy };
}

export function runK4Test() {
  const viewports = [
    { w: 1046, h: 768, name: '1046x768' },
    { w: 704, h: 768, name: '704x768' },
    { w: 390, h: 420, name: '390x420' },
  ];

  const results: ArchetypeCamTest[] = [];

  for (const robot of ROBOTS) {
    for (const vp of viewports) {
      const { w, h, name: vpName } = vp;
      const targetX = w / 2;
      const targetY = h / 2;

      // 1. Initial Reset View state
      const initialCam: RobotCameraState = { follow: true, offset: { x: 0, y: 0 }, smoothedPV: 0 };
      const initialRes = computeRobotCamera(w, h, 0, robot.defaultSetpoint, initialCam, 48, robot.id);

      const camDeltaX = Math.abs(initialRes.robotScreenX - targetX);
      const camDeltaY = Math.abs(initialRes.robotScreenY - targetY);

      // 2. Drawn coordinates
      const drawn = getDrawnRobotCoords(robot.id, w, h, 0);
      const drawnDeltaX = drawn.x - targetX;
      const drawnDeltaY = drawn.y - targetY;
      const isDrawnCentered = Math.abs(drawnDeltaX) <= 2 && Math.abs(drawnDeltaY) <= 2;

      // 3. Pan extreme Left: offset.x = -99999
      const panLeftCam: RobotCameraState = { follow: false, offset: { x: -99999, y: 0 }, smoothedPV: 0 };
      const panLeftRes = computeRobotCamera(w, h, 0, robot.defaultSetpoint, panLeftCam, 48, robot.id);
      const panLeftMargin = panLeftRes.anchorScreenX!; // distance from left edge (x=0)

      // 4. Pan extreme Right: offset.x = +99999
      const panRightCam: RobotCameraState = { follow: false, offset: { x: 99999, y: 0 }, smoothedPV: 0 };
      const panRightRes = computeRobotCamera(w, h, 0, robot.defaultSetpoint, panRightCam, 48, robot.id);
      const panRightMargin = w - panRightRes.anchorScreenX!; // distance from right edge (x=w)

      // 5. Pan extreme Top: offset.y = -99999
      const panTopCam: RobotCameraState = { follow: false, offset: { x: 0, y: -99999 }, smoothedPV: 0 };
      const panTopRes = computeRobotCamera(w, h, 0, robot.defaultSetpoint, panTopCam, 48, robot.id);
      const panTopMargin = panTopRes.anchorScreenY!; // distance from top edge (y=0)

      // 6. Pan extreme Bottom: offset.y = +99999
      const panBottomCam: RobotCameraState = { follow: false, offset: { x: 0, y: 99999 }, smoothedPV: 0 };
      const panBottomRes = computeRobotCamera(w, h, 0, robot.defaultSetpoint, panBottomCam, 48, robot.id);
      const panBottomMargin = h - panBottomRes.anchorScreenY!; // distance from bottom edge (y=h)

      results.push({
        robotId: robot.id,
        name: robot.name,
        viewport: vpName,
        w,
        h,
        camFocalX: initialRes.robotScreenX,
        camFocalY: initialRes.robotScreenY,
        targetX,
        targetY,
        camDeltaX,
        camDeltaY,
        drawnRobotX: drawn.x,
        drawnRobotY: drawn.y,
        drawnDeltaX,
        drawnDeltaY,
        isDrawnCentered,
        panLeftMargin,
        panRightMargin,
        panTopMargin,
        panBottomMargin,
      });
    }
  }

  console.log(JSON.stringify(results, null, 2));
}

runK4Test();
