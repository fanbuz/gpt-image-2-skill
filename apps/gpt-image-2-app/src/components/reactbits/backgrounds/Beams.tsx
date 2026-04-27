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
      const field = diagonal * 1.35;
      const thickness = Math.max(44, beamWidth * 24 + beamHeight * 1.7);

      ctx.clearRect(0, 0, width, height);
      ctx.fillStyle = "#020711";
      ctx.fillRect(0, 0, width, height);

      const ambient = ctx.createRadialGradient(
        width * 0.55,
        height * 0.42,
        0,
        width * 0.55,
        height * 0.42,
        diagonal * 0.72,
      );
      ambient.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.18)`);
      ambient.addColorStop(0.42, "rgba(16, 185, 129, 0.08)");
      ambient.addColorStop(1, "rgba(2, 7, 17, 0)");
      ctx.fillStyle = ambient;
      ctx.fillRect(0, 0, width, height);

      ctx.save();
      ctx.translate(width / 2, height / 2);
      ctx.rotate((rotation * Math.PI) / 180);
      ctx.translate(-field / 2, -field / 2);
      ctx.globalCompositeOperation = "screen";

      for (let i = 0; i < beamNumber; i += 1) {
        const lane = i / Math.max(1, beamNumber);
        const travel = (phase * 76 + i * 53) % (field + thickness * 3);
        const y = lane * field + travel - thickness * 1.5;
        const drift = Math.sin(phase * 0.34 + i * 1.7) * field * scale;
        const x = field * 0.5 + drift;
        const length = field * (0.84 + 0.12 * Math.sin(i + phase * 0.5));
        const glowAlpha = 0.2 + 0.1 * Math.sin(phase * 0.7 + i);

        const gradient = ctx.createLinearGradient(
          0,
          y - thickness,
          0,
          y + thickness,
        );
        gradient.addColorStop(0, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);
        gradient.addColorStop(
          0.34,
          `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, ${glowAlpha})`,
        );
        gradient.addColorStop(
          0.48,
          `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0.58)`,
        );
        gradient.addColorStop(0.52, "rgba(236, 253, 255, 0.82)");
        gradient.addColorStop(0.66, "rgba(16, 185, 129, 0.22)");
        gradient.addColorStop(1, `rgba(${rgb[0]}, ${rgb[1]}, ${rgb[2]}, 0)`);

        ctx.save();
        ctx.translate(x, y);
        ctx.rotate(Math.sin(phase * 0.2 + i) * 0.08);
        ctx.fillStyle = gradient;
        ctx.filter = "blur(16px)";
        ctx.fillRect(-length / 2, -thickness, length, thickness * 2);
        ctx.filter = "blur(1.8px)";
        ctx.fillStyle = `rgba(236, 253, 255, ${0.34 + glowAlpha})`;
        ctx.fillRect(
          -length * 0.45,
          -Math.max(1, beamWidth * 0.8),
          length * 0.9,
          Math.max(2, beamWidth * 1.2),
        );
        ctx.restore();
      }

      ctx.restore();
      ctx.filter = "none";

      if (noisePattern) {
        ctx.globalCompositeOperation = "soft-light";
        ctx.globalAlpha = Math.min(0.18, 0.05 + noiseIntensity * 0.035);
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
