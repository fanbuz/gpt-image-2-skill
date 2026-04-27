import { useEffect, useRef, type FC } from "react";

interface BeamsProps {
  beamWidth?: number;
  beamHeight?: number;
  beamNumber?: number;
  lightColor?: string;
  speed?: number;
  noiseIntensity?: number;
  scale?: number;
  rotation?: number;
}

const hexToRgb = (hex: string): [number, number, number] => {
  const clean = hex.replace("#", "");
  if (!/^[0-9a-f]{6}$/i.test(clean)) return [125, 211, 252];
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16),
  ];
};

/**
 * Lightweight canvas take on React Bits' Beams background.
 *
 * The original preset used Three.js for volumetric planes, but that
 * pulled an 800KB+ vendor chunk into the app for a passive background.
 * This keeps the same sweeping-light feel with 2D gradients and a tiny
 * noise pass, so the theme remains animated without bloating startup.
 */
const Beams: FC<BeamsProps> = ({
  beamWidth = 2,
  beamHeight = 18,
  beamNumber = 12,
  lightColor = "#7dd3fc",
  speed = 2,
  noiseIntensity = 1.6,
  scale = 0.2,
  rotation = 30,
}) => {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: false });
    if (!ctx) return;

    let animationId = 0;
    let noisePattern: CanvasPattern | null = null;
    const rgb = hexToRgb(lightColor);

    const buildNoise = () => {
      const noise = document.createElement("canvas");
      const size = 96;
      noise.width = size;
      noise.height = size;
      const noiseCtx = noise.getContext("2d");
      if (!noiseCtx) return null;
      const image = noiseCtx.createImageData(size, size);
      for (let i = 0; i < image.data.length; i += 4) {
        const value = 255 * Math.random();
        image.data[i] = value;
        image.data[i + 1] = value;
        image.data[i + 2] = value;
        image.data[i + 3] = 18 + noiseIntensity * 8;
      }
      noiseCtx.putImageData(image, 0, 0);
      return ctx.createPattern(noise, "repeat");
    };

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const { width, height } = canvas.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      noisePattern = buildNoise();
    };

    resize();
    const observer = new ResizeObserver(resize);
    observer.observe(canvas);

    const draw = (time: number) => {
      const { width, height } = canvas.getBoundingClientRect();
      const diagonal = Math.hypot(width, height);
      const phase = (time / 1000) * speed;

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#02040a";
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-width / 2, -height / 2);
      ctx.globalCompositeOperation = "lighter";

      for (let i = 0; i < beamNumber; i += 1) {
        const lane = i / Math.max(1, beamNumber - 1);
        const drift = Math.sin(phase * 0.42 + i * 1.7) * diagonal * scale;
        const x = lane * diagonal - diagonal * 0.25 + drift;
        const y = height / 2 + Math.cos(phase * 0.34 + i) * height * 0.18;
        const thickness = Math.max(18, beamWidth * 18 + beamHeight * 0.8);
        const length = diagonal * (0.52 + 0.08 * Math.sin(i + phase));

        const gradient = ctx.createLinearGradient(x, y - thickness, x, y + thickness);
        gradient.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
        gradient.addColorStop(0.48, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.34)`);
        gradient.addColorStop(0.52, "rgba(255, 255, 255, 0.45)");
        gradient.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(phase * 0.2 + i) * 0.08);
        ctx.fillStyle = gradient;
        ctx.filter = "blur(18px)";
        ctx.fillRect(-length / 2, -thickness / 2, length, thickness);
        ctx.restore();
      }

      ctx.restore();

      if (noisePattern) {
        ctx.globalCompositeOperation = "overlay";
        ctx.globalAlpha = Math.min(0.28, 0.08 + noiseIntensity * 0.05);
        ctx.fillStyle = noisePattern;
        ctx.fillRect(0, 0, width, height);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
      }

      animationId = requestAnimationFrame(draw);
    };

    animationId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(animationId);
      observer.disconnect();
    };
  }, [beamHeight, beamNumber, beamWidth, lightColor, noiseIntensity, rotation, scale, speed]);

  return <canvas ref={canvasRef} className="h-full w-full" aria-hidden />;
};

export default Beams;
