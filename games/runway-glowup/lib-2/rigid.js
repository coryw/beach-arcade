// kit/three/rigid.js — optional rigid bodies on the vendored cannon-es 0.20.0: boxes, spheres, ground, ragdolls.
// The ONLY toolbox file that imports "cannon-es". A game that imports it adds exactly one importmap key (§2.1):
//   "cannon-es": "../../vendor/cannon-es/0.20.0/cannon-es.js"
// Deterministic because W.step() runs ONLY inside startLoop's step, once per fixed step, with the fixed dt; call
// W.sync() in render(). Budget: ≤ 60 dynamic bodies (a warning past it); still bodies sleep. Hitstop passes dt 0,
// so step(dt) with dt 0 freezes the world with the rest of the game.
// API, costs and examples: kit/three/README.md (fragment: README.d/rigid.md).
import * as THREE from "three";
import * as CANNON from "cannon-es";

const RAG = 4;   // collision group of ragdoll parts: they hit the world and other bodies, never each other
const _p = new THREE.Vector3(), _q = new THREE.Quaternion(), _s = new THREE.Vector3(), _pq = new THREE.Quaternion();
const IDENTITY = new THREE.Matrix4();

const vec = (v, fn) => {
  if (Array.isArray(v)) return new CANNON.Vec3(v[0] || 0, v[1] || 0, v[2] || 0);
  if (v && typeof v === "object") return new CANNON.Vec3(v.x || 0, v.y || 0, v.z || 0);
  throw new Error(`${fn}: expected [x, y, z] or {x, y, z}`);
};

// Box extents of an object in its own (rotated, world-scaled) frame: {half, center} with center relative to its origin.
function extents(obj) {
  obj.updateWorldMatrix(true, true);
  obj.matrixWorld.decompose(_p, _q, _s);
  const scale = new THREE.Vector3(Math.abs(_s.x), Math.abs(_s.y), Math.abs(_s.z));
  let box;
  if (obj.geometry) {
    if (!obj.geometry.boundingBox) obj.geometry.computeBoundingBox();
    box = obj.geometry.boundingBox.clone();
  } else {
    box = new THREE.Box3().setFromObject(obj);
    if (!box.isEmpty()) box.applyMatrix4(obj.matrixWorld.clone().invert());
  }
  if (box.isEmpty()) box.set(new THREE.Vector3(-0.25, -0.25, -0.25), new THREE.Vector3(0.25, 0.25, 0.25));
  box.min.multiply(scale); box.max.multiply(scale);
  const half = box.getSize(new THREE.Vector3()).multiplyScalar(0.5).max(new THREE.Vector3(0.01, 0.01, 0.01));
  return { half, center: box.getCenter(new THREE.Vector3()) };
}

export function world({ gravity = [0, -20, 0], fixedStep, iterations = 8, friction = 0.4, restitution = 0.2,
                        linearDamping = 0.05, angularDamping = 0.3, budget = 60 } = {}) {
  if (fixedStep === undefined || fixedStep === null) throw new Error("world: fixedStep is required — pass the loop's fixed STEP in seconds (1 / hz)");
  if (!(fixedStep > 0 && fixedStep <= 0.1)) throw new Error(`world: fixedStep is in seconds (1/60 ≈ 0.0167), got ${fixedStep}`);
  const w = new CANNON.World({ gravity: vec(gravity, "world"), allowSleep: true });
  w.broadphase = new CANNON.SAPBroadphase(w);
  w.solver.iterations = iterations;
  w.defaultContactMaterial.friction = friction;
  w.defaultContactMaterial.restitution = restitution;
  const links = new Map();   // body → Object3D it drives
  let warned = false;

  const dynamic = () => { let n = 0; for (const b of w.bodies) if (b.type === CANNON.Body.DYNAMIC) n++; return n; };
  function add(body, mesh) {
    body.allowSleep = true; body.sleepSpeedLimit = 0.2; body.sleepTimeLimit = 0.5;
    body.linearDamping = linearDamping; body.angularDamping = angularDamping;   // lets balls stop rolling and piles sleep
    w.addBody(body);
    if (mesh) links.set(body, mesh);
    if (!warned && dynamic() > budget) {
      warned = true;
      console.warn(`rigid: ${dynamic()} dynamic bodies, over the ${budget} budget — remove() the old ones`);
    }
    return body;
  }
  function place(body, obj) {
    obj.updateWorldMatrix(true, false);
    obj.matrixWorld.decompose(_p, _q, _s);
    body.position.set(_p.x, _p.y, _p.z);
    body.quaternion.set(_q.x, _q.y, _q.z, _q.w);
    body.previousPosition.copy(body.position); body.interpolatedPosition.copy(body.position);
    return body;
  }
  function boxBody(obj, mass, size) {
    const { half, center } = size ? { half: new THREE.Vector3(size[0] / 2, size[1] / 2, size[2] / 2), center: new THREE.Vector3() } : extents(obj);
    const body = new CANNON.Body({ mass });
    body.addShape(new CANNON.Box(new CANNON.Vec3(half.x, half.y, half.z)), new CANNON.Vec3(center.x, center.y, center.z));
    return place(body, obj);
  }
  // body → object: world pose converted into the object's parent frame, so a part can stay inside its rig group.
  function syncOne(body, obj) {
    obj.position.set(body.position.x, body.position.y, body.position.z);
    obj.quaternion.set(body.quaternion.x, body.quaternion.y, body.quaternion.z, body.quaternion.w);
    const parent = obj.parent;
    if (!parent) return;
    parent.updateWorldMatrix(true, false);
    if (parent.matrixWorld.equals(IDENTITY)) return;   // the usual case: a mesh straight under the scene
    parent.worldToLocal(obj.position);
    parent.matrixWorld.decompose(_p, _pq, _s);
    obj.quaternion.premultiply(_pq.invert());
  }

  const W = {
    CANNON, world: w,
    step(dt = fixedStep) { if (dt > 0) w.step(dt); },
    box(mesh, { mass = 1, size = null } = {}) {
      if (!mesh || !mesh.isObject3D) throw new Error("box: mesh must be a THREE.Object3D");
      if (size && !(Array.isArray(size) && size.length === 3)) throw new Error("box: size is [w, h, d]");
      return add(boxBody(mesh, mass, size), mesh);
    },
    sphere(mesh, { mass = 1, r = null } = {}) {
      if (!mesh || !mesh.isObject3D) throw new Error("sphere: mesh must be a THREE.Object3D");
      let radius = r, center = new THREE.Vector3();
      if (radius == null) {
        const { half, center: c } = extents(mesh);
        radius = Math.max(half.x, half.y, half.z); center = c;
      }
      const body = new CANNON.Body({ mass });
      body.addShape(new CANNON.Sphere(radius), new CANNON.Vec3(center.x, center.y, center.z));
      return add(place(body, mesh), mesh);
    },
    ground(y = 0) {
      const body = new CANNON.Body({ mass: 0, type: CANNON.Body.STATIC });
      body.addShape(new CANNON.Plane());
      body.quaternion.setFromEuler(-Math.PI / 2, 0, 0);
      body.position.set(0, y, 0);
      return add(body, null);
    },
    remove(body) { if (!body) return; w.removeBody(body); links.delete(body); },
    sync() { for (const [body, obj] of links) if (body.type !== CANNON.Body.STATIC) syncOne(body, obj); },
    ragdoll(root, { parts, mass = 1 } = {}) {
      if (!root || !root.isObject3D) throw new Error("ragdoll: root must be a THREE.Object3D");
      if (!parts || !parts.torso) throw new Error("ragdoll: parts.torso is required");
      const limbs = [...(parts.legs || []), ...(parts.arms || [])];
      const all = [["torso", parts.torso, mass * 2], ...(parts.head ? [["head", parts.head, mass * 0.5]] : []),
                   ...limbs.map((o) => ["limb", o, mass * 0.6])];
      root.updateWorldMatrix(true, true);
      const saved = all.map(([, o]) => ({ o, pos: o.position.clone(), quat: o.quaternion.clone() }));
      const bodies = all.map(([, o, m]) => {
        const b = boxBody(o, m, null);
        b.collisionFilterGroup = RAG; b.collisionFilterMask = ~RAG;
        return add(b, o);
      });
      const torso = bodies[0], joints = [];
      all.forEach(([kind, o], i) => {
        if (i === 0) return;
        const bb = new THREE.Box3().setFromObject(o), c = bb.getCenter(new THREE.Vector3());
        const j = new CANNON.Vec3(c.x, kind === "head" ? bb.min.y : bb.max.y, c.z);   // neck under the head, hip/shoulder atop a limb
        const k = new CANNON.PointToPointConstraint(torso, torso.pointToLocalFrame(j), bodies[i], bodies[i].pointToLocalFrame(j));
        k.collideConnected = false;
        w.addConstraint(k); joints.push(k);
      });
      let active = true;
      return {
        bodies, get active() { return active; },
        fling(impulse = [0, 8, 0], { spin = 6 } = {}) {
          if (!active) return;
          const J = vec(impulse, "fling"), total = bodies.reduce((a, b) => a + b.mass, 0);
          for (const b of bodies) { b.wakeUp(); b.applyImpulse(J.scale(b.mass / total)); }
          torso.angularVelocity.set((Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin, (Math.random() - 0.5) * spin);
        },
        end() {   // the rig comes back together: bodies and joints leave the world, parts return to their rest pose
          if (!active) return;
          active = false;
          for (const k of joints) w.removeConstraint(k);
          for (const b of bodies) W.remove(b);
          for (const { o, pos, quat } of saved) { o.position.copy(pos); o.quaternion.copy(quat); }
        },
      };
    },
    get count() { return dynamic(); },
  };
  return W;
}
