import * as THREE from '../vendor/three/three.module.js';

const cast = ['cat', 'fox', 'panda', 'rabbit'];
const up = new THREE.Vector3(0, 1, 0);
const vector = () => new THREE.Vector3();
const world = node => node.getWorldPosition(vector());
const maxLean = .24;
const wristOffset = (arm, target) => target.clone()
  .sub(world(arm.grip).sub(world(arm.paw))).sub(world(arm.upper));

// Rotate a joint in its parent's coordinate system, preserving the authored twist.
function aim(joint, child, destination) {
  const origin = world(joint);
  const inverse = joint.parent.getWorldQuaternion(new THREE.Quaternion()).invert();
  const from = world(child).sub(origin).applyQuaternion(inverse).normalize();
  const to = destination.clone().sub(origin).applyQuaternion(inverse).normalize();
  joint.quaternion.premultiply(new THREE.Quaternion().setFromUnitVectors(from, to));
}

function reach(arm, target, angle) {
  const { upper, fore, paw, grip } = arm;
  const shoulder = world(upper);
  // Keep the curled paw aligned with the tile and solve for its wrist.
  const palm = world(grip).sub(world(paw));
  const wrist = target.clone().sub(palm);
  const axis = wrist.clone().sub(shoulder);
  const distance = Math.max(.0001, axis.length());
  axis.divideScalar(distance);
  const d = THREE.MathUtils.clamp(distance, Math.abs(arm.a-arm.b)+.00001, arm.a+arm.b-.00001);
  const along = (arm.a*arm.a - arm.b*arm.b + d*d) / (2*d);
  const pole = new THREE.Vector3(arm.side*.70, -.78, .22).applyAxisAngle(up, angle);
  pole.addScaledVector(axis, -pole.dot(axis)).normalize();
  const elbow = shoulder.clone().addScaledVector(axis, along)
    .addScaledVector(pole, Math.sqrt(Math.max(0, arm.a*arm.a-along*along)));
  aim(upper, fore, elbow);
  aim(fore, paw, shoulder.clone().addScaledVector(axis,d));
  aim(paw, grip, world(paw).add(palm));
}

export function createCompanions(scene, templates, { reduced = false } = {}) {
  const rigs = cast.map((animal, pos) => {
    // Each animal is used once. Keep the imported skeleton bound to its own mesh.
    const body = templates.get('companion-'+animal);
    const angle = pos*Math.PI/2;
    body.position.set(0,animal==='rabbit'?.30:.29,.68).applyAxisAngle(up,angle);
    body.rotation.y = angle + Math.PI;
    body.scale.setScalar(.88);
    scene.add(body);
    const mixer = new THREE.AnimationMixer(body);
    mixer.clipAction(body.animations[0]).play();
    mixer.update(0);
    const bone = name => body.getObjectByName(THREE.PropertyBinding.sanitizeNodeName(name));
    const chest = bone('Chest'), head = bone('Head');
    const arms = [-1,1].map(side => {
      const suffix = side<0 ? '.L' : '.R';
      const upper = bone('UpperArm'+suffix), fore = bone('Forearm'+suffix), paw = bone('Paw'+suffix);
      const grip = new THREE.Object3D();
      grip.position.set(0, .039, -.003);
      paw.add(grip);
      return {side,upper,fore,paw,grip,rest:world(grip),a:world(upper).distanceTo(world(fore)),
        b:world(fore).distanceTo(world(paw)),rotations:[upper,fore,paw].map(o=>o.quaternion.clone())};
    });
    return {pos,angle,body,mixer,chest,head,arms,chestRest:chest.position.clone(),
      headRest:head.quaternion.clone(),hold:null,activeArm:null};
  });
  function update(now, holds = []) {
    for (const rig of rigs) {
      const {pos,angle,chest,head,arms} = rig;
      let hold = null;
      for (let i = holds.length - 1; i >= 0; i--) {
        if (holds[i].pos === pos) {
          hold = holds[i];
          break;
        }
      }
      const localX = hold?.point.clone().applyAxisAngle(up,-angle).x || 0;
      let active = hold && arms[localX < -.035 ? 0 : 1];
      chest.position.copy(rig.chestRest);
      for (const arm of arms) {
        [arm.upper,arm.fore,arm.paw].forEach((joint,i)=>joint.quaternion.copy(arm.rotations[i]));
      }
      if (active) {
        // Test the final contact, not the interpolated lead-in, before committing to a grip.
        const distance = wristOffset(active, hold.point).length();
        if (distance < Math.abs(active.a-active.b) || distance > active.a+active.b+maxLean) {
          hold = active = null;
        }
      }
      rig.hold = hold;
      rig.activeArm = active;
      head.quaternion.copy(rig.headRest);
      head.rotateY(hold ? THREE.MathUtils.clamp(-localX*.65,-.24,.24)*hold.grip
        : reduced ? 0 : Math.sin(now*.0012+pos)*.045);
      if (active) {
        const target = active.rest.clone().lerp(hold.point,hold.grip);
        const offset = wristOffset(active, target);
        // Lean from the hips for distant tiles while the feet stay on the chair.
        const lean = Math.max(0, offset.length()-active.a-active.b+.004);
        offset.normalize().multiplyScalar(Math.min(maxLean,lean));
        chest.position.copy(chest.parent.worldToLocal(world(chest).add(offset)));
        reach(active,target,angle);
      } else if (!reduced) {
        const arm = arms[pos%2];
        const dest = arm.rest.clone();
        dest.y += pos===2 ? .038*(1+Math.sin(now*.0008)) : .003*Math.sin(now*.0014+pos);
        reach(arm,dest,angle);
      }
    }
  }
  return {count:rigs.length,cast,update,
    reset() { update(0); },
    setView(overhead) { rigs[0].body.visible=!overhead; },
    inspect() { return rigs.map(r=>({pos:r.pos,animal:cast[r.pos],holding:!!r.hold,
      grip:r.hold?.grip||0,error:r.hold ? world(r.activeArm.grip).distanceTo(r.hold.point) : 0})); }
  };
}
