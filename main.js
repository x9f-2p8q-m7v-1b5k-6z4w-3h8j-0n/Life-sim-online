'use strict';
// main.js - Startup and the main animation loop
// ============================================================================
// MAIN ANIMATION LOOP & UI EVENTS
// ============================================================================
updateChunkStreaming(player.position.x, player.position.z, true);

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.04);
  if(running) {
    updatePlayer(dt);
    updateCars(dt);
    updateParticles(dt);
    fxUpdate(dt);

    const activePos = (inCar && activeCar) ? activeCar.root.position : player.position;
    updateChunkStreaming(activePos.x, activePos.z, false);

    updateCameraAndEnvironment(dt);
    updateHUDAndRadar();
    mpTick(dt);
  }
  fxRender();
}
animate();

document.getElementById('startButton').addEventListener('click', () => {
  const nameInput = document.getElementById('playerNameInput');
  const enteredName = String(nameInput.value || '').replace(/[<>]/g, '').trim().slice(0,18);
  if(!enteredName) {
    nameInput.focus();
    nameInput.style.borderColor = '#ff7070';
    toast('Enter a player name before joining');
    return;
  }
  mpDisplayName = enteredName;
  nameInput.value = enteredName;
  nameInput.disabled = true;
  running = true;
  startScreen.style.display = 'none';
  startMultiplayer();
  lockPointer();
  toast(`Welcome, ${mpDisplayName} · Joining LifeSim Metropolis`);
});

document.getElementById('playerNameInput').addEventListener('keydown', e => {
  if(e.key === 'Enter') document.getElementById('startButton').click();
});

document.getElementById('resetButton').addEventListener('click', resetPosition);

document.getElementById('dayButton').addEventListener('click', () => {
  if(true) { fxCycleTime(); return; }
  isDayMode = !isDayMode;
  if(isDayMode) {
    scene.background.set(0x8bbcd9);
    scene.fog.color.set(0x8bbcd9);
    skyMat.uniforms.top.value.set(0x2d6ba4);
    skyMat.uniforms.horizon.value.set(0xb6dbed);
    sun.intensity = 3.2;
    hemi.intensity = 1.85;
    sunDisc.visible = true;
    starField.material.opacity = 0;
    sharedMat.winLit.emissive.setHex(0x000000);
    sharedMat.winLit.emissiveIntensity = 0;
    if(activeCar) activeCar.headlights.forEach(hl => hl.intensity = 0);
    document.getElementById('dayButton').textContent = '☀ Day';
  } else {
    scene.background.set(0x060b16);
    scene.fog.color.set(0x060b16);
    skyMat.uniforms.top.value.set(0x02050c);
    skyMat.uniforms.horizon.value.set(0x111d30);
    sun.intensity = 0.24;
    hemi.intensity = 0.34;
    sunDisc.visible = false;
    starField.material.opacity = 1;
    sharedMat.winLit.emissive.setHex(0xffc970);
    sharedMat.winLit.emissiveIntensity = 0.85;
    if(activeCar) activeCar.headlights.forEach(hl => hl.intensity = 5.4);
    document.getElementById('dayButton').textContent = '☾ Night';
  }
});

addEventListener('beforeunload', () => {
  if(mpLocalNameplate) mpLocalNameplate.remove();
  for(const avatar of mpRemoteAvatars.values()) avatar.nameplate?.remove();
});

addEventListener('resize', () => {
  camera.aspect = innerWidth / innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(innerWidth, innerHeight);
});

loading.remove();
