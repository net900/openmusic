import { useEffect, useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import * as THREE from 'three';
import type { RoomVisualPresetId } from '../../lib/roomVisualPreset';
import { toProxiedMediaUrl } from '../../lib/mediaProxyUrl';
import { makeDotTexture } from './lib/dotTexture';
import { readGalaxyAudioBands, resumeGalaxyAudioContext } from './lib/galaxyAudio';
import { buildGalaxyParticleGeometry } from './lib/particleGeometry';
import {
  PARTICLE_BLOOM_FRAGMENT_SHADER,
  PARTICLE_BLOOM_VERTEX_SHADER,
  PARTICLE_FRAGMENT_SHADER,
} from './lib/shaders';
import { roomVisualFxLive } from '../../lib/roomVisualFxLive';
import { effectiveBloomStrength, syncGalaxyFxUniforms } from './lib/syncVisualUniforms';
import { buildCoverEdgeTexture } from './lib/buildCoverEdgeTexture';
import { PARTICLE_VERTEX_SHADER } from './lib/visualVertexShader';

const DEFAULT_COVER = '#1c1c28';

function makePlaceholderTexture(color = DEFAULT_COVER): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 4;
  const x = c.getContext('2d');
  if (x) {
    x.fillStyle = color;
    x.fillRect(0, 0, 4, 4);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.minFilter = THREE.LinearFilter;
  tex.magFilter = THREE.LinearFilter;
  return tex;
}

interface Props {
  coverUrl?: string | null;
  preset: RoomVisualPresetId;
  isPlaying: boolean;
}

export default function GalaxyParticles({ coverUrl, preset, isPlaying }: Props) {
  const geometry = useMemo(() => buildGalaxyParticleGeometry(), []);
  const bloomGeometry = useMemo(() => geometry.clone(), [geometry]);
  const dotTex = useMemo(() => makeDotTexture(), []);
  const edgeTexRef = useRef<THREE.Texture>(makePlaceholderTexture('#800000'));
  const edgeTex = edgeTexRef.current;
  const rippleTex = useMemo(() => makePlaceholderTexture('#000000'), []);
  const coverTex = useRef<THREE.Texture>(makePlaceholderTexture());
  const prevCoverTex = useRef<THREE.Texture>(makePlaceholderTexture());
  const colorMixRef = useRef(1);
  const presetRef = useRef(preset);
  const burstRef = useRef(0);
  const bloomRef = useRef<THREE.Points>(null);

  const uniforms = useRef({
    uTime: { value: 0 },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uTreble: { value: 0 },
    uBeat: { value: 0 },
    uEnergy: { value: 0 },
    uBurstAmt: { value: 0 },
    uPreset: { value: preset },
    uIntensity: { value: roomVisualFxLive.current.intensity },
    uDepth: { value: roomVisualFxLive.current.depth },
    uPointScale: { value: roomVisualFxLive.current.point },
    uSpeed: { value: roomVisualFxLive.current.speed },
    uTwist: { value: roomVisualFxLive.current.twist },
    uVinylSpin: { value: 0 },
    uColorBoost: { value: roomVisualFxLive.current.colorBoost },
    uScatter: { value: roomVisualFxLive.current.scatter },
    uCoverRes: { value: roomVisualFxLive.current.coverResolution },
    uBgFade: { value: roomVisualFxLive.current.bgFade },
    uBloomStrength: { value: effectiveBloomStrength(roomVisualFxLive.current) },
    uBloomSize: { value: 2.65 },
    uHasCover: { value: 0 },
    uHasDepth: { value: 0 },
    uEdgeEnabled: { value: roomVisualFxLive.current.edge ? 1 : 0 },
    uAiBoost: { value: 0 },
    uMouseActive: { value: 0 },
    uMouseXY: { value: new THREE.Vector2(-999, -999) },
    uHandXY: { value: new THREE.Vector2(-999, -999) },
    uHandActive: { value: 0 },
    uGestureGrip: { value: 0 },
    uTintColor: { value: new THREE.Color(roomVisualFxLive.current.visualTintColor) },
    uTintStrength: { value: roomVisualFxLive.current.visualTintMode === 'custom' ? 0.42 : 0 },
    uPixel: { value: Math.min(window.devicePixelRatio || 1, 1.75) },
    uColorMixT: { value: 1 },
    uLoading: { value: 0 },
    uCoverTex: { value: coverTex.current },
    uPrevCoverTex: { value: prevCoverTex.current },
    uEdgeTex: { value: edgeTex },
    uRippleTex: { value: rippleTex },
    uRippleCount: { value: 0 },
    uDotTex: { value: dotTex },
    uAlpha: { value: 1 },
    uParticleDim: { value: 1 },
  }).current;

  const material = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_VERTEX_SHADER,
        fragmentShader: PARTICLE_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        blending: THREE.NormalBlending,
      }),
    [uniforms],
  );

  const bloomMaterial = useMemo(
    () =>
      new THREE.ShaderMaterial({
        uniforms,
        vertexShader: PARTICLE_BLOOM_VERTEX_SHADER,
        fragmentShader: PARTICLE_BLOOM_FRAGMENT_SHADER,
        transparent: true,
        depthWrite: false,
        depthTest: false,
        blending: THREE.AdditiveBlending,
      }),
    [uniforms],
  );

  useEffect(() => {
    if (presetRef.current !== preset) {
      presetRef.current = preset;
      burstRef.current = 0.35;
      uniforms.uColorMixT.value = 1;
      colorMixRef.current = 1;
    }
    uniforms.uPreset.value = preset;
  }, [preset, uniforms]);

  useEffect(() => {
    const prev = coverTex.current;
    prevCoverTex.current = prev;
    uniforms.uColorMixT.value = 0;
    colorMixRef.current = 0;
    uniforms.uHasDepth.value = 0;

    if (!coverUrl) {
      const placeholder = makePlaceholderTexture();
      coverTex.current = placeholder;
      uniforms.uCoverTex.value = placeholder;
      uniforms.uHasCover.value = 0;
      return;
    }

    let cancelled = false;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      if (cancelled) return;
      const tex = new THREE.Texture(img);
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.needsUpdate = true;
      coverTex.current = tex;
      uniforms.uCoverTex.value = tex;
      uniforms.uHasCover.value = 1;

      try {
        const sourceCanvas = document.createElement('canvas');
        sourceCanvas.width = img.naturalWidth || img.width;
        sourceCanvas.height = img.naturalHeight || img.height;
        const ctx = sourceCanvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(img, 0, 0);
          const edgeCanvas = buildCoverEdgeTexture(sourceCanvas);
          const prevEdge = edgeTexRef.current;
          const nextEdge = new THREE.CanvasTexture(edgeCanvas);
          nextEdge.minFilter = THREE.LinearFilter;
          nextEdge.magFilter = THREE.LinearFilter;
          nextEdge.needsUpdate = true;
          edgeTexRef.current = nextEdge;
          uniforms.uEdgeTex.value = nextEdge;
          uniforms.uHasDepth.value = 0.55;
          if (prevEdge && prevEdge !== nextEdge) prevEdge.dispose();
        }
      } catch {
        // 边缘贴图失败时仍保留封面粒子
      }
    };
    img.onerror = () => {
      if (cancelled) return;
      const placeholder = makePlaceholderTexture();
      coverTex.current = placeholder;
      uniforms.uCoverTex.value = placeholder;
      uniforms.uHasCover.value = 0;
      uniforms.uHasDepth.value = 0;
    };
    img.src = toProxiedMediaUrl(coverUrl);

    return () => {
      cancelled = true;
      img.onload = null;
      img.onerror = null;
    };
  }, [coverUrl, uniforms]);

  useFrame((state, delta) => {
    const currentFx = roomVisualFxLive.current;
    syncGalaxyFxUniforms(uniforms, currentFx);

    resumeGalaxyAudioContext();
    const bands = readGalaxyAudioBands();
    uniforms.uTime.value = state.clock.elapsedTime;
    uniforms.uBass.value = bands.bass;
    uniforms.uMid.value = bands.mid;
    uniforms.uTreble.value = bands.treble;
    uniforms.uBeat.value = bands.beat;
    uniforms.uEnergy.value = bands.energy;
    uniforms.uPixel.value = state.gl.getPixelRatio();
    uniforms.uVinylSpin.value = isPlaying
      ? state.clock.elapsedTime * currentFx.speed * 0.42
      : state.clock.elapsedTime * 0.05;

    if (bloomRef.current) {
      bloomRef.current.visible = effectiveBloomStrength(currentFx) > 0;
    }

    burstRef.current *= 1 - delta * 2.5;
    uniforms.uBurstAmt.value = burstRef.current;

    colorMixRef.current = Math.min(1, colorMixRef.current + delta / 0.55);
    uniforms.uColorMixT.value = colorMixRef.current;
  });

  useEffect(
    () => () => {
      geometry.dispose();
      bloomGeometry.dispose();
      material.dispose();
      bloomMaterial.dispose();
      dotTex.dispose();
      edgeTexRef.current.dispose();
      rippleTex.dispose();
      coverTex.current.dispose();
      prevCoverTex.current.dispose();
    },
    [bloomGeometry, bloomMaterial, dotTex, geometry, material, rippleTex],
  );

  return (
    <>
      <points
        ref={bloomRef}
        geometry={bloomGeometry}
        material={bloomMaterial}
        frustumCulled={false}
        renderOrder={0}
      />
      <points geometry={geometry} material={material} frustumCulled={false} renderOrder={1} />
    </>
  );
}
