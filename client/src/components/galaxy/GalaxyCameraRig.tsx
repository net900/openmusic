import { useEffect, useRef } from 'react';

import { useFrame, useThree } from '@react-three/fiber';

import * as THREE from 'three';

import type { RoomVisualPresetId } from '../../lib/roomVisualPreset';

import { roomVisualFxLive } from '../../lib/roomVisualFxLive';

import { resumeGalaxyAudioContext } from './lib/galaxyAudio';

import { tickGalaxyCinema } from './lib/galaxyCinema';

import {
  applyGalaxyOrbitCinema,
  setGalaxyOrbitFocusZone,
  setGalaxyOrbitPreset,
  updateGalaxyOrbitCamera,
} from './lib/galaxyOrbit';

import { galaxyOrbitRef } from './lib/galaxyOrbit';

interface Props {
  preset: RoomVisualPresetId;
  immersivePanelFocus?: 'search' | 'queue' | 'chat' | null;
}

export default function GalaxyCameraRig({ preset, immersivePanelFocus = null }: Props) {
  const { camera } = useThree();
  const cinemaTRef = useRef(0);
  const persp = camera as THREE.PerspectiveCamera;

  useEffect(() => {
    setGalaxyOrbitPreset(galaxyOrbitRef.current, preset);
  }, [preset]);

  useEffect(() => {
    const orbit = galaxyOrbitRef.current;
    if (immersivePanelFocus === 'queue') {
      setGalaxyOrbitFocusZone(orbit, 'queue', {
        theta: 0.4,
        phi: 0.05,
        radius: 5.8,
        lookAt: new THREE.Vector3(0, 0, 0),
        ease: 0.11,
      });
    } else if (immersivePanelFocus === 'chat') {
      setGalaxyOrbitFocusZone(orbit, 'chat', {
        theta: -0.4,
        phi: 0.05,
        radius: 5.8,
        lookAt: new THREE.Vector3(0, 0, 0),
        ease: 0.11,
      });
    } else if (immersivePanelFocus === 'search') {
      setGalaxyOrbitFocusZone(orbit, 'search', {
        theta: 0,
        phi: 0.06,
        radius: 6.1,
        lookAt: new THREE.Vector3(0, 0, 0),
        ease: 0.1,
      });
    } else {
      setGalaxyOrbitFocusZone(orbit, 'none');
    }
  }, [immersivePanelFocus]);

  useFrame((_state, delta) => {
    const fx = roomVisualFxLive.current;
    const orbit = galaxyOrbitRef.current;
    cinemaTRef.current += delta;

    resumeGalaxyAudioContext();
    const kick = tickGalaxyCinema(delta);
    applyGalaxyOrbitCinema(orbit, cinemaTRef.current, kick, fx.cinema ? fx.cinemaShake : 0);

    updateGalaxyOrbitCamera(persp, orbit, kick, fx.cinema ? fx.cinemaShake : 0, fx.cameraDistance);
  });

  return null;
}
