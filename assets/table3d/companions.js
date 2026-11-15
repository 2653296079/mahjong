import * as THREE from '../vendor/three/three.module.js';

// Original animal cast. Arm endpoints and held tiles share the same world-space target.
export function createCompanions(scene, templates, { reduced = false } = {}) {
  const cast = ['cat', 'fox', 'panda', 'rabbit'];
  const fur = ['#d6954d', '#b96535', '#36352e', '#eee0c4'];
  const cloth = ['#44685b', '#927052', '#4d6555', '#b8a17d'];
  const up = new THREE.Vector3(0, 1, 0), rigs = [];
  const v = (x,y,z) => new THREE.Vector3(x,y,z);
  const sphere = new THREE.SphereGeometry(1, 16, 12);
  const cylinder = new THREE.CylinderGeometry(1, 1, 1, 12);
  const point = (pos, x,y,z) => v(x,y,z).applyAxisAngle(up, pos*Math.PI/2);
  function mesh(geometry, material) {
    const m = new THREE.Mesh(geometry, material); m.castShadow = true; scene.add(m); return m;
  }
  function limb(m, a, b, r0, r1 = r0) {
    m.position.copy(a).add(b).multiplyScalar(0.5);
    m.quaternion.setFromUnitVectors(up, b.clone().sub(a).normalize());
    m.scale.set(r0, a.distanceTo(b), r1);
  }
  for (let pos=0;pos<4;pos++) {
    const body=templates.get('companion-'+cast[pos]).clone(true);
    body.position.copy(point(pos,0,0,0.68)); body.rotation.y=pos*Math.PI/2; scene.add(body);
    let skin, sleeve;
    body.traverse(o=>{for(const m of (Array.isArray(o.material)?o.material:[o.material])) {
      if(m?.name === (pos===2?'ink':cast[pos]+' fur')) skin=m;
      if(m?.name === cast[pos]+' linen') sleeve=m;
    }});
    skin ||= new THREE.MeshStandardMaterial({color:fur[pos],roughness:0.88});
    sleeve ||= new THREE.MeshStandardMaterial({color:cloth[pos],roughness:0.98});
    const arms=[];
    for (const side of [-1,1]) {
      const shoulder=point(pos,side*0.105,0.855,0.635);
      const rest=point(pos,side*0.12,0.795,0.49);
      const upper=mesh(cylinder,sleeve), lower=mesh(cylinder,skin), paw=mesh(sphere,skin);
      const elbow=mesh(sphere,sleeve),thumb=mesh(sphere,skin);
      const fingers=[mesh(sphere,skin),mesh(sphere,skin),mesh(sphere,skin)];
      arms.push({side,shoulder,rest,current:rest.clone(),upper,lower,paw,elbow,thumb,fingers});
    }
    rigs.push({pos,body,arms,head:body.getObjectByName('Head'),eyes:[body.getObjectByName('EyeL'),body.getObjectByName('EyeR')],target:null,blend:0});
  }
  let last=0;
  function update(now, holds = []) {
    const dt=Math.min(0.05,Math.max(0,(now-last)/1000)); last=now;
    rigs.forEach(r=>{r.target=null;});
    for (const hold of holds) if (rigs[hold.pos]) rigs[hold.pos].target=hold;
    for (const r of rigs) {
      const idle = reduced ? 0 : Math.sin(now*0.0015+r.pos*1.4);
      const head=r.head;
      const localTarget=r.target?.point.clone().applyAxisAngle(up,-r.pos*Math.PI/2);
      const gaze=localTarget ? THREE.MathUtils.clamp(-Math.atan2(localTarget.x,.68-localTarget.z),-.28,.28) : idle*.035;
      const follow=reduced?1:1-Math.exp(-dt*9);
      if(head) { head.rotation.y += (gaze-head.rotation.y)*follow; head.rotation.x += ((r.target ? -.10 : idle*.018)-head.rotation.x)*follow; }
      const blinkPhase=(now+r.pos*1137)%4600/160;
      const blink=!reduced && blinkPhase<1 ? Math.sin(blinkPhase*Math.PI) : 0;
      for(const eye of r.eyes) if(eye) eye.scale.y=1-blink*.95;
      const hold=r.target;
      const localX=hold ? hold.point.clone().applyAxisAngle(up,-r.pos*Math.PI/2).x : 0;
      for(const arm of r.arms) {
        const working=hold && arm.side===(localX < -0.035 ? -1 : 1);
        const dest=working ? hold.point.clone() : arm.rest.clone();
        if(!working && !reduced) {
          dest.y+=idle*0.0015;
          if(r.pos===2 && arm.side===1) {
            const cycle=(now%9000)/9000;
            const thought=Math.max(0,Math.min(1,(cycle-.2)/.1,(.7-cycle)/.1));
            dest.lerp(point(r.pos,.04,.965,.55),thought);
          }
          if(r.pos===3 && arm.side===-1) dest.x+=Math.sin(now*.0018)*.004;
        }
        // During the reach lead-in the tile remains still; at grab time the paw is exact.
        const weight=working ? hold.grip : 0;
        if(working) arm.current.copy(arm.rest).lerp(dest,weight);
        else arm.current.lerp(dest,reduced?1:1-Math.exp(-dt*12));
        const a=arm.shoulder,b=arm.current;
        const mid=a.clone().lerp(b,0.48);
        const pole=point(r.pos,arm.side*0.075,-0.065,0.025);
        mid.add(pole);
        limb(arm.upper,a,mid,0.026); limb(arm.lower,mid,b,0.019);
        arm.elbow.position.copy(mid);arm.elbow.scale.setScalar(.024);
        arm.paw.position.copy(b); arm.paw.scale.set(0.025,0.018,0.025);
        arm.paw.quaternion.setFromAxisAngle(up,r.pos*Math.PI/2);
        const across=point(r.pos,1,0,0),forward=point(r.pos,0,0,-1);
        arm.thumb.position.copy(b).addScaledVector(across,-arm.side*.024).addScaledVector(forward,.006);
        arm.thumb.position.y-=working?.010:.003;
        arm.thumb.scale.set(.012,.016,.011);arm.thumb.quaternion.copy(arm.paw.quaternion);
        arm.fingers.forEach((finger,i)=>{
          finger.position.copy(b).addScaledVector(across,(i-1)*0.013).addScaledVector(forward,0.012);
          finger.position.y-=working?0.014:0.005;
          finger.scale.set(0.009,working?0.021:0.012,0.01);
          finger.quaternion.copy(arm.paw.quaternion);
        });
      }
    }
  }
  return {update,count:4,cast,
    reset() { for(const r of rigs) {r.target=null;for(const arm of r.arms)arm.current.copy(arm.rest);} },
    setView(overhead) { for(const r of rigs) r.body.visible=!overhead || r.pos!==0; },
    inspect() { return rigs.map(r=>({pos:r.pos,animal:cast[r.pos],holding:!!r.target,
      grip:r.target?.grip||0,error:r.target ? Math.min(...r.arms.map(a=>a.current.distanceTo(r.target.point))) : 0})); }
  };
}
