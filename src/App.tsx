/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { Trophy, RotateCcw, Flag, Info, AlertCircle, Palette, Sun, Music } from 'lucide-react';
import confetti from 'canvas-confetti';

// Constants
const FRICTION = 0.985;
const RESET_DELAY = 300;

// Base physics values (will be scaled)
const BASE_BALL_RADIUS = 8;
const BASE_HOLE_RADIUS = 18;
const BASE_MIN_VELOCITY = 0.1;
const BASE_POWER_MULTIPLIER = 0.15;
const BASE_MAX_POWER = 150;
const BASE_SINK_SPEED = 10;
const REFERENCE_WIDTH = 1600; // Reference width for scaling
const REFERENCE_HEIGHT = 900; // Reference height for scaling

// Theme Configuration
const THEME = {
  name: 'Summer',
  greenGradient: ['#3a7332', '#2d5a27', '#1e3c1a'], // More stops for smoothness
  holeColor: '#000000',
  pinColor: '#ffffff',
  flagColor: '#ef4444',
  textureColor: 'rgba(0, 0, 0, 0.05)',
  ballColor: '#ffffff',
  confettiColors: ['#ffffff', '#ff0000', '#ffff00', '#00ff00', '#0000ff', '#ff00ff'],
  textColor: 'text-white',
  fireColors: ['rgba(255, 60, 0, 0.7)', 'rgba(255, 150, 0, 0.5)', 'rgba(255, 220, 0, 0.3)'],
};

interface Point {
  x: number;
  y: number;
}

interface GameState {
  ballPos: Point;
  ballVel: Point;
  holePos: Point;
  strokes: number;
  isMoving: boolean;
  isDragging: boolean;
  dragStart: Point | null;
  dragCurrent: Point | null;
  gameOver: boolean;
  isResetting: boolean;
  isGameWon: boolean;
  level: number;
  totalScore: number;
  streak: number;
  trail: Point[];
}

export default function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const resetTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  
  const [gameState, setGameState] = useState<GameState>({
    ballPos: { x: 0, y: 0 },
    ballVel: { x: 0, y: 0 },
    holePos: { x: 0, y: 0 },
    strokes: 0,
    isMoving: false,
    isDragging: false,
    dragStart: null,
    dragCurrent: null,
    gameOver: false,
    isResetting: false,
    isGameWon: false,
    level: 1,
    totalScore: 0,
    streak: 0,
    trail: [],
  });

  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const [tick, setTick] = useState(0);
  const [showToast, setShowToast] = useState(false);
  const [hasShotOnce, setHasShotOnce] = useState(false);
  const [streakGoal, setStreakGoal] = useState(10);
  const [showGoalSelector, setShowGoalSelector] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const noisePatternRef = useRef<CanvasPattern | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);

  const theme = THEME;

  // Dynamic physics scaling
  const getPhysics = useCallback(() => {
    const { width, height } = dimensions;
    if (width === 0 || height === 0) {
      return {
        scale: 1,
        visualScale: 1,
        ballRadius: BASE_BALL_RADIUS,
        holeRadius: BASE_HOLE_RADIUS,
        minVelocity: BASE_MIN_VELOCITY,
        powerMultiplier: BASE_POWER_MULTIPLIER,
        maxPower: BASE_MAX_POWER,
        sinkSpeed: BASE_SINK_SPEED,
        margin: 100,
      };
    }
    
    // Calculate scale based on area/diagonal relative to a standard 1080p-ish screen
    const currentDiagonal = Math.sqrt(width ** 2 + height ** 2);
    const refDiagonal = Math.sqrt(REFERENCE_WIDTH ** 2 + REFERENCE_HEIGHT ** 2);
    const scale = currentDiagonal / refDiagonal;
    
    // Dampen visual scaling so it doesn't look "zoomed in" on huge screens
    const visualScale = Math.min(Math.pow(scale, 0.45), 1.5);
    
    // Physics scaling: ensure mobile (small scale) still has enough power
    // We use a floor for the physics scale to prevent it from becoming too weak
    const physicsScale = Math.max(scale, 0.7);
    
    return {
      scale,
      visualScale,
      ballRadius: BASE_BALL_RADIUS * visualScale,
      holeRadius: BASE_HOLE_RADIUS * visualScale,
      minVelocity: BASE_MIN_VELOCITY * scale,
      powerMultiplier: BASE_POWER_MULTIPLIER * physicsScale,
      maxPower: BASE_MAX_POWER * physicsScale,
      // Sink speed needs to be very generous on large screens because velocities are higher
      sinkSpeed: BASE_SINK_SPEED * scale * 1.5, 
      margin: Math.min(width, height) * 0.12,
      topPadding: 100, // Extra padding for top UI
    };
  }, [dimensions]);

  const physics = getPhysics();

  // Audio Synthesis
  const playSound = useCallback((type: 'hit' | 'sink' | 'win' | 'pop') => {
    if (isMuted) return;
    
    if (!audioCtxRef.current) {
      audioCtxRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
    }
    
    const ctx = audioCtxRef.current;
    if (ctx.state === 'suspended') {
      ctx.resume();
    }

    const masterGain = ctx.createGain();
    masterGain.gain.setValueAtTime(0.15, ctx.currentTime);
    masterGain.connect(ctx.destination);

    if (type === 'hit') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(150, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(40, ctx.currentTime + 0.1);
      gain.gain.setValueAtTime(0.5, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.1);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start();
      osc.stop(ctx.currentTime + 0.1);
    } else if (type === 'sink') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(200, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(100, ctx.currentTime + 0.2);
      gain.gain.setValueAtTime(0.8, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.3);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start();
      osc.stop(ctx.currentTime + 0.3);
    } else if (type === 'win') {
      const notes = [523.25, 659.25, 783.99, 1046.50]; // C5, E5, G5, C6
      notes.forEach((freq, i) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, ctx.currentTime + i * 0.1);
        gain.gain.setValueAtTime(0, ctx.currentTime + i * 0.1);
        gain.gain.linearRampToValueAtTime(0.3, ctx.currentTime + i * 0.1 + 0.05);
        gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + i * 0.1 + 0.4);
        osc.connect(gain);
        gain.connect(masterGain);
        osc.start(ctx.currentTime + i * 0.1);
        osc.stop(ctx.currentTime + i * 0.1 + 0.5);
      });
    } else if (type === 'pop') {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(400, ctx.currentTime + 0.05);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.05);
      osc.connect(gain);
      gain.connect(masterGain);
      osc.start();
      osc.stop(ctx.currentTime + 0.05);
    }
  }, [isMuted]);

  // Toast trigger for streak
  useEffect(() => {
    if (gameState.streak === 3 || gameState.streak === 7) {
      setShowToast(true);
      const timer = setTimeout(() => setShowToast(false), 3000);
      return () => clearTimeout(timer);
    }
  }, [gameState.streak]);

  // Animation tick for fire effect
  useEffect(() => {
    let frame: number;
    const loop = () => {
      setTick(t => t + 1);
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, []);

  // Initialize level
  const initLevel = useCallback((level: number, width: number, height: number, streak: number = 0) => {
    const margin = Math.min(width, height) * 0.12;
    const topPadding = 100; // Safe area for UI
    
    const holeX = margin + Math.random() * (width - margin * 2);
    const holeY = margin + topPadding + Math.random() * (height / 3 - margin - topPadding);
    const ballX = margin + Math.random() * (width - margin * 2);
    const ballY = height - margin - Math.random() * (height / 3 - margin);

    if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);

    setGameState(prev => ({
      ...prev,
      ballPos: { x: ballX, y: ballY },
      ballVel: { x: 0, y: 0 },
      holePos: { x: holeX, y: holeY },
      isMoving: false,
      isDragging: false,
      dragStart: null,
      dragCurrent: null,
      gameOver: false,
      isResetting: false,
      isGameWon: false,
      level,
      strokes: 0,
      streak,
      trail: [],
    }));
  }, []);

  const resetEntireGame = useCallback(() => {
    const { width, height } = dimensions;
    
    // Ensure we have valid dimensions
    if (width === 0 || height === 0) return;

    const margin = Math.min(width, height) * 0.12;
    const topPadding = 100; // Safe area for UI
    
    const holeX = margin + Math.random() * (width - margin * 2);
    const holeY = margin + topPadding + Math.random() * (height / 3 - margin - topPadding);
    const ballX = margin + Math.random() * (width - margin * 2);
    const ballY = height - margin - Math.random() * (height / 3 - margin);

    if (resetTimeoutRef.current) clearTimeout(resetTimeoutRef.current);

    setGameState({
      ballPos: { x: ballX, y: ballY },
      ballVel: { x: 0, y: 0 },
      holePos: { x: holeX, y: holeY },
      isMoving: false,
      isDragging: false,
      dragStart: null,
      dragCurrent: null,
      gameOver: false,
      isResetting: false,
      isGameWon: false,
      level: 1,
      strokes: 0,
      streak: 0,
      totalScore: 0,
      trail: [],
    });
  }, [dimensions]);

  // Handle Resize
  useEffect(() => {
    const handleResize = () => {
      const { innerWidth, innerHeight } = window;
      setDimensions({ width: innerWidth, height: innerHeight });
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Initial Level Setup
  useEffect(() => {
    if (dimensions.width > 0 && gameState.ballPos.x === 0) {
      initLevel(1, dimensions.width, dimensions.height, 0);
    }
  }, [dimensions, gameState.ballPos.x, initLevel]);

  // Win screen confetti effect
  useEffect(() => {
    if (gameState.isGameWon) {
      playSound('win');
      const isUltimate = streakGoal === 10;
      const interval = setInterval(() => {
        playSound('pop');
        // Left stream
        confetti({
          particleCount: isUltimate ? 8 : 3,
          angle: 60,
          spread: 55,
          origin: { x: 0, y: 0.8 },
          colors: isUltimate ? ['#FFD700', '#FFA500', '#FFFFFF'] : theme.confettiColors,
          ticks: 200,
          gravity: 1.2,
          scalar: isUltimate ? 1.5 : 1.2,
        });
        // Right stream
        confetti({
          particleCount: isUltimate ? 8 : 3,
          angle: 120,
          spread: 55,
          origin: { x: 1, y: 0.8 },
          colors: isUltimate ? ['#FFD700', '#FFA500', '#FFFFFF'] : theme.confettiColors,
          ticks: 200,
          gravity: 1.2,
          scalar: isUltimate ? 1.5 : 1.2,
        });
      }, 100);
      return () => clearInterval(interval);
    }
  }, [gameState.isGameWon, theme.confettiColors, streakGoal]);

  // Confetti Trigger (Volcano from hole)
  const triggerConfetti = useCallback((x: number, y: number, isMassive: boolean = false) => {
    const relX = x / window.innerWidth;
    const relY = y / window.innerHeight;
    
    if (isMassive) {
      const duration = 5 * 1000;
      const animationEnd = Date.now() + duration;
      const defaults = { startVelocity: 30, spread: 360, ticks: 60, zIndex: 0 };

      const randomInRange = (min: number, max: number) => Math.random() * (max - min) + min;

      const interval: any = setInterval(function() {
        const timeLeft = animationEnd - Date.now();

        if (timeLeft <= 0) {
          return clearInterval(interval);
        }

        const particleCount = 50 * (timeLeft / duration);
        confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.1, 0.3), y: Math.random() - 0.2 }, colors: theme.confettiColors });
        confetti({ ...defaults, particleCount, origin: { x: randomInRange(0.7, 0.9), y: Math.random() - 0.2 }, colors: theme.confettiColors });
      }, 250);
      return;
    }

    // Initial burst
    confetti({
      particleCount: 100,
      spread: 60,
      origin: { x: relX, y: relY },
      startVelocity: 45,
      gravity: 1.2,
      colors: theme.confettiColors,
    });

    // Sustained volcano effect
    let count = 0;
    const interval = setInterval(() => {
      confetti({
        particleCount: 20,
        angle: 90,
        spread: 40,
        origin: { x: relX, y: relY },
        startVelocity: 35,
        gravity: 1.5,
        colors: theme.confettiColors,
      });
      count++;
      if (count > 5) clearInterval(interval);
    }, 150);
  }, [theme]);

  // Game Loop
  useEffect(() => {
    let animationFrameId: number;

    const update = () => {
      setGameState(prev => {
        if (!prev.isMoving || prev.gameOver) return prev;

        let { x, y } = prev.ballPos;
        let { x: vx, y: vy } = prev.ballVel;

        // Apply velocity
        x += vx;
        y += vy;

        // Apply friction
        vx *= FRICTION;
        vy *= FRICTION;

        // Gravity pull towards hole
        const dxHole = prev.holePos.x - x;
        const dyHole = prev.holePos.y - y;
        const distHole = Math.sqrt(dxHole * dxHole + dyHole * dyHole);
        if (distHole < physics.holeRadius * 2.5) {
          const force = (1 - distHole / (physics.holeRadius * 2.5)) * 0.2 * physics.scale;
          vx += (dxHole / distHole) * force;
          vy += (dyHole / distHole) * force;
        }

        // Check if off-screen
        const isOffScreen = x < -50 || x > dimensions.width + 50 || y < -50 || y > dimensions.height + 50;

        // Check hole collision
        const l2 = vx * vx + vy * vy;
        let distToHole = Infinity;
        if (l2 === 0) {
          distToHole = Math.sqrt(Math.pow(x - prev.holePos.x, 2) + Math.pow(y - prev.holePos.y, 2));
        } else {
          let t = ((prev.holePos.x - prev.ballPos.x) * (x - prev.ballPos.x) + (prev.holePos.y - prev.ballPos.y) * (y - prev.ballPos.y)) / l2;
          t = Math.max(0, Math.min(1, t));
          const closestX = prev.ballPos.x + t * (x - prev.ballPos.x);
          const closestY = prev.ballPos.y + t * (y - prev.ballPos.y);
          distToHole = Math.sqrt(Math.pow(prev.holePos.x - closestX, 2) + Math.pow(prev.holePos.y - closestY, 2));
        }

        if (distToHole < physics.holeRadius) {
          const speed = Math.sqrt(vx * vx + vy * vy);
          if (speed < physics.sinkSpeed) {
            playSound('sink');
            const newStreak = prev.streak + 1;
            const isWin = newStreak >= streakGoal;
            triggerConfetti(prev.holePos.x, prev.holePos.y, isWin);
            return {
              ...prev,
              ballPos: { x: prev.holePos.x, y: prev.holePos.y },
              ballVel: { x: 0, y: 0 },
              isMoving: false,
              gameOver: true,
              isGameWon: isWin,
              totalScore: prev.totalScore + 1,
              streak: newStreak,
            };
          }
        }

        // Stop if slow or off-screen
        if ((Math.abs(vx) < physics.minVelocity && Math.abs(vy) < physics.minVelocity) || isOffScreen) {
          return {
            ...prev,
            ballPos: { x, y },
            ballVel: { x: 0, y: 0 },
            isMoving: false,
          };
        }

        return {
          ...prev,
          ballPos: { x, y },
          ballVel: { x: vx, y: vy },
          trail: [...prev.trail, { x, y }].slice(-30),
        };
      });

      animationFrameId = requestAnimationFrame(update);
    };

    if (gameState.isMoving && !gameState.gameOver) {
      animationFrameId = requestAnimationFrame(update);
    }

    return () => cancelAnimationFrame(animationFrameId);
  }, [gameState.isMoving, gameState.gameOver, dimensions, triggerConfetti, physics, playSound, streakGoal]);

  // Handle Auto-Reset (Unified for Win and Miss)
  useEffect(() => {
    const hasFinishedTurn = !gameState.isMoving && gameState.strokes > 0 && !gameState.isResetting;
    
    if (hasFinishedTurn) {
      if (gameState.isGameWon) {
        // Massive win reset
        setGameState(prev => ({ ...prev, isResetting: true }));
        setTimeout(() => {
          resetEntireGame();
        }, 5000);
        return;
      }

      setGameState(prev => ({ ...prev, isResetting: true }));
      
      resetTimeoutRef.current = setTimeout(() => {
        const nextLevelNum = gameState.gameOver ? gameState.level + 1 : gameState.level;
        const nextStreak = gameState.gameOver ? gameState.streak : 0;
        initLevel(nextLevelNum, dimensions.width, dimensions.height, nextStreak);
      }, RESET_DELAY);
    }
  }, [gameState.isMoving, gameState.gameOver, gameState.strokes, gameState.isResetting, gameState.level, gameState.streak, gameState.isGameWon, dimensions, initLevel, resetEntireGame]);

  // Render
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.save();
    // Clear
    ctx.clearRect(0, 0, dimensions.width, dimensions.height);

    // Draw Green
    const gradient = ctx.createRadialGradient(
      dimensions.width / 2, dimensions.height / 2, 0,
      dimensions.width / 2, dimensions.height / 2, dimensions.width
    );
    gradient.addColorStop(0, '#4a8a3f');
    gradient.addColorStop(0.2, '#3a7332');
    gradient.addColorStop(0.5, '#2d5a27');
    gradient.addColorStop(0.8, '#1e3c1a');
    gradient.addColorStop(1, '#152b12');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, dimensions.width, dimensions.height);

    // Draw Noise to prevent banding (using a pattern for performance)
    if (!noisePatternRef.current) {
      const noiseCanvas = document.createElement('canvas');
      noiseCanvas.width = 128;
      noiseCanvas.height = 128;
      const noiseCtx = noiseCanvas.getContext('2d');
      if (noiseCtx) {
        const noiseData = noiseCtx.createImageData(128, 128);
        for (let i = 0; i < noiseData.data.length; i += 4) {
          const val = Math.random() * 255;
          noiseData.data[i] = val;
          noiseData.data[i + 1] = val;
          noiseData.data[i + 2] = val;
          noiseData.data[i + 3] = 15; // Very faint
        }
        noiseCtx.putImageData(noiseData, 0, 0);
        noisePatternRef.current = ctx.createPattern(noiseCanvas, 'repeat');
      }
    }

    if (noisePatternRef.current) {
      ctx.fillStyle = noisePatternRef.current;
      ctx.fillRect(0, 0, dimensions.width, dimensions.height);
    }

    // Draw Grass Texture
    ctx.fillStyle = theme.textureColor;
    for (let i = 0; i < 1000; i++) {
      const x = (Math.sin(i) * 10000) % dimensions.width;
      const y = (Math.cos(i) * 10000) % dimensions.height;
      ctx.fillRect(x, y, 2, 2);
    }

    // Draw Hole
    ctx.beginPath();
    ctx.arc(gameState.holePos.x, gameState.holePos.y, physics.holeRadius, 0, Math.PI * 2);
    ctx.fillStyle = theme.holeColor;
    ctx.fill();
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.2)';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Draw Flag
    ctx.beginPath();
    ctx.moveTo(gameState.holePos.x, gameState.holePos.y);
    ctx.lineTo(gameState.holePos.x, gameState.holePos.y - 40 * physics.visualScale);
    ctx.strokeStyle = theme.pinColor;
    ctx.lineWidth = 2;
    ctx.stroke();
    
    ctx.beginPath();
    ctx.moveTo(gameState.holePos.x, gameState.holePos.y - 40 * physics.visualScale);
    ctx.lineTo(gameState.holePos.x + 15 * physics.visualScale, gameState.holePos.y - 32 * physics.visualScale);
    ctx.lineTo(gameState.holePos.x, gameState.holePos.y - 25 * physics.visualScale);
    ctx.fillStyle = theme.flagColor;
    ctx.fill();

    // Draw Drag Line
    if (gameState.isDragging && gameState.dragStart && gameState.dragCurrent) {
      const dx = gameState.dragStart.x - gameState.dragCurrent.x;
      const dy = gameState.dragStart.y - gameState.dragCurrent.y;
      const dist = Math.min(Math.sqrt(dx * dx + dy * dy), physics.maxPower);
      const angle = Math.atan2(dy, dx);

      ctx.beginPath();
      ctx.moveTo(gameState.ballPos.x, gameState.ballPos.y);
      ctx.lineTo(
        gameState.ballPos.x + Math.cos(angle) * dist,
        gameState.ballPos.y + Math.sin(angle) * dist
      );
      ctx.strokeStyle = `rgba(255, 255, 255, ${dist / physics.maxPower})`;
      ctx.setLineDash([5, 5]);
      ctx.lineWidth = 3;
      ctx.stroke();
      ctx.setLineDash([]);
    }

    // Draw Trail
    if (gameState.trail.length > 1) {
      const speed = Math.sqrt(gameState.ballVel.x ** 2 + gameState.ballVel.y ** 2);
      const baseWidth = physics.ballRadius * (1 + speed * (0.05 / physics.visualScale));

      // Glow effect
      ctx.save();
      ctx.shadowBlur = 15 * physics.visualScale;
      ctx.shadowColor = theme.ballColor;
      
      ctx.beginPath();
      ctx.moveTo(gameState.trail[0].x, gameState.trail[0].y);
      for (let i = 1; i < gameState.trail.length; i++) {
        ctx.lineTo(gameState.trail[i].x, gameState.trail[i].y);
      }
      ctx.strokeStyle = theme.ballColor + '22';
      ctx.lineWidth = baseWidth;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.stroke();
      ctx.restore();

      // Tapered and Fading segments
      for (let i = 0; i < gameState.trail.length - 1; i++) {
        const progress = i / gameState.trail.length;
        const alpha = progress * 0.6;
        const width = baseWidth * progress;
        
        ctx.beginPath();
        ctx.moveTo(gameState.trail[i].x, gameState.trail[i].y);
        ctx.lineTo(gameState.trail[i + 1].x, gameState.trail[i + 1].y);
        ctx.strokeStyle = `rgba(255, 255, 255, ${alpha})`;
        ctx.lineWidth = width;
        ctx.lineCap = 'round';
        ctx.stroke();
      }
    }

    // Draw Ball
    if (!gameState.gameOver) {
      // Fire effect for streaks
      if (gameState.streak > 1) {
        let fireScale = gameState.streak * 8 * physics.visualScale;
        if (gameState.streak > 5) {
          fireScale = 84 * Math.pow(2, gameState.streak - 5) * physics.visualScale;
        } else if (gameState.streak > 3) {
          fireScale = (24 + (gameState.streak - 3) * 30) * physics.visualScale;
        }
        
        const particleCount = Math.min(12 + gameState.streak * 4, 100);
        const time = Date.now() / 100;
        
        for (let i = 0; i < particleCount; i++) {
          const angle = (i / particleCount) * Math.PI * 2 + time;
          const flicker = Math.sin(time * 2 + i) * 5 * physics.visualScale;
          const offsetX = Math.cos(angle) * (physics.ballRadius + Math.random() * fireScale + flicker);
          const offsetY = Math.sin(angle) * (physics.ballRadius + Math.random() * fireScale + flicker);
          
          ctx.beginPath();
          ctx.arc(gameState.ballPos.x + offsetX, gameState.ballPos.y + offsetY, (3 + Math.random() * 5) * physics.visualScale, 0, Math.PI * 2);
          ctx.fillStyle = theme.fireColors[i % theme.fireColors.length];
          ctx.fill();
        }
      }

      ctx.beginPath();
      ctx.arc(gameState.ballPos.x, gameState.ballPos.y, physics.ballRadius, 0, Math.PI * 2);
      ctx.fillStyle = theme.ballColor;
      ctx.shadowBlur = 5 * physics.visualScale;
      ctx.shadowColor = 'rgba(0,0,0,0.5)';
      ctx.fill();
      ctx.shadowBlur = 0;
    }

    ctx.restore();
  }, [gameState, dimensions, tick, theme, physics]);

  // Input Handlers
  const handleStart = (e: React.MouseEvent | React.TouchEvent) => {
    if (gameState.isMoving || gameState.gameOver || gameState.isResetting || gameState.strokes > 0) return;
    
    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setGameState(prev => ({
      ...prev,
      isDragging: true,
      dragStart: { x: clientX, y: clientY },
      dragCurrent: { x: clientX, y: clientY },
    }));
  };

  const handleMove = (e: React.MouseEvent | React.TouchEvent) => {
    if (!gameState.isDragging) return;

    const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
    const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

    setGameState(prev => ({
      ...prev,
      dragCurrent: { x: clientX, y: clientY },
    }));
  };

  const handleEnd = () => {
    if (!gameState.isDragging || !gameState.dragStart || !gameState.dragCurrent) return;

    const dx = gameState.dragStart.x - gameState.dragCurrent.x;
    const dy = gameState.dragStart.y - gameState.dragCurrent.y;
    const dist = Math.min(Math.sqrt(dx * dx + dy * dy), physics.maxPower);
    const angle = Math.atan2(dy, dx);

    if (dist > 10 * physics.visualScale) {
      playSound('hit');
      setHasShotOnce(true);
      setGameState(prev => ({
        ...prev,
        isMoving: true,
        isDragging: false,
        dragStart: null,
        dragCurrent: null,
        ballVel: {
          x: Math.cos(angle) * dist * physics.powerMultiplier,
          y: Math.sin(angle) * dist * physics.powerMultiplier,
        },
        strokes: 1,
        trail: [],
      }));
    } else {
      setGameState(prev => ({
        ...prev,
        isDragging: false,
        dragStart: null,
        dragCurrent: null,
      }));
    }
  };

  const resetGame = () => {
    initLevel(1, dimensions.width, dimensions.height, 0);
    setGameState(prev => ({ ...prev, totalScore: 0 }));
  };

  const nextLevel = () => {
    initLevel(gameState.level + 1, dimensions.width, dimensions.height, gameState.streak);
  };

  return (
    <div className="fixed inset-0 bg-slate-950 overflow-hidden font-sans select-none touch-none">
      {/* Game Screen (Always Mounted) */}
      <div className="absolute inset-0">
        <canvas
          ref={canvasRef}
          width={dimensions.width}
          height={dimensions.height}
          onMouseDown={handleStart}
          onMouseMove={handleMove}
          onMouseUp={handleEnd}
          onTouchStart={handleStart}
          onTouchMove={handleMove}
          onTouchEnd={handleEnd}
          className="block w-full h-full cursor-crosshair"
        />

            {/* Toast Notification */}
            <AnimatePresence>
              {showToast && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.5, y: 50 }}
                  animate={{ opacity: 1, scale: 1, y: 0 }}
                  exit={{ opacity: 0, scale: 0.5, y: -50 }}
                  className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 z-50 pointer-events-none w-full flex justify-center px-4"
                >
                  <div className={`${gameState.streak >= 7 ? 'bg-red-600' : 'bg-orange-600'} text-white px-4 py-2 sm:px-8 sm:py-4 rounded-xl sm:rounded-2xl shadow-2xl border-2 sm:border-4 border-yellow-400 flex items-center gap-2 sm:gap-4 whitespace-nowrap`}>
                    <span className="text-2xl sm:text-4xl">🔥</span>
                    <span className="text-xl sm:text-3xl font-black uppercase italic tracking-tighter">
                      {gameState.streak >= 7 ? "He's on Fire!" : "He's Heating Up!"}
                    </span>
                    <span className="text-2xl sm:text-4xl">{gameState.streak >= 7 ? '🚨' : '⛳'}</span>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>

            {/* UI Overlay */}
            <div className="absolute top-0 left-0 w-full p-6 flex justify-between items-start pointer-events-none">
              <div className="flex flex-col gap-1">
                <div className={`flex items-center gap-2 ${theme.textColor} font-bold text-2xl tracking-tight`}>
                  <Flag className="w-6 h-6" />
                  <span>Hole {gameState.level}</span>
                </div>
                <div className="flex items-center gap-3">
                  <div className={`${theme.textColor} opacity-70 font-medium`}>
                    Total Sunk: <span className="opacity-100 font-bold">{gameState.totalScore}</span>
                  </div>
                  <div className={`${theme.textColor} opacity-70 font-medium`}>
                    Goal: <span className="opacity-100 font-bold">{streakGoal}</span>
                  </div>
                  {gameState.streak > 1 && (
                    <div className="bg-orange-500 px-3 py-0.5 rounded-full text-xs font-black text-white animate-pulse uppercase tracking-wider">
                      {gameState.streak}x Streak
                    </div>
                  )}
                </div>
              </div>

              <div className="flex items-center gap-2 pointer-events-auto">
                <button
                  onClick={() => setIsMuted(!isMuted)}
                  className="p-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-all active:scale-95 border border-white/10"
                  title={isMuted ? "Unmute" : "Mute"}
                >
                  {isMuted ? <Music className="w-4 h-4 opacity-50" /> : <Music className="w-4 h-4" />}
                </button>
                <div className="relative">
                  <button
                    onClick={() => setShowGoalSelector(!showGoalSelector)}
                    className="px-4 py-2 bg-white/10 hover:bg-white/20 backdrop-blur-md rounded-full text-white transition-all active:scale-95 flex items-center gap-2 border border-white/10"
                    title="Set Streak Goal"
                  >
                    <Trophy className={`w-4 h-4 ${streakGoal >= 7 ? 'text-yellow-400' : 'text-slate-300'}`} />
                    <span className="text-xs font-black uppercase tracking-widest">Goal: {streakGoal}</span>
                  </button>
                  
                  <AnimatePresence>
                    {showGoalSelector && (
                      <motion.div
                        initial={{ opacity: 0, y: 10, scale: 0.95 }}
                        animate={{ opacity: 1, y: 0, scale: 1 }}
                        exit={{ opacity: 0, y: 10, scale: 0.95 }}
                        className="absolute top-full right-0 mt-2 p-4 bg-slate-900/90 backdrop-blur-xl rounded-2xl border border-white/10 shadow-2xl z-[110] w-48"
                      >
                        <div className="flex flex-col gap-3">
                          <div className="flex justify-between items-center">
                            <span className="text-[10px] font-black text-white/50 uppercase tracking-widest">Streak Goal</span>
                            <span className="text-sm font-bold text-yellow-400">{streakGoal}</span>
                          </div>
                          <input
                            type="range"
                            min="2"
                            max="10"
                            step="1"
                            value={streakGoal}
                            onChange={(e) => setStreakGoal(parseInt(e.target.value))}
                            className="w-full h-1.5 bg-white/10 rounded-lg appearance-none cursor-pointer accent-yellow-400"
                          />
                          <div className="flex justify-between text-[8px] font-bold text-white/30 uppercase">
                            <span>2</span>
                            <span>10</span>
                          </div>
                        </div>
                      </motion.div>
                    )}
                  </AnimatePresence>
                </div>
              </div>
            </div>

            {/* Instructions */}
            {!hasShotOnce && !gameState.isMoving && !gameState.gameOver && gameState.strokes === 0 && !gameState.isResetting && (
              <motion.div
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: 20 }}
                className="absolute bottom-8 sm:bottom-12 left-1/2 -translate-x-1/2 pointer-events-none w-max max-w-[90vw]"
              >
                <div className="bg-black/40 backdrop-blur-md px-4 py-2 sm:px-6 sm:py-3 rounded-full flex items-center gap-2 sm:gap-3 text-white/90 border border-white/10">
                  <Info className="w-3 h-3 sm:w-4 sm:h-4" />
                  <span className="text-xs sm:text-sm font-medium">One shot only! Pull back to aim</span>
                </div>
              </motion.div>
            )}

            {/* Score Overlay */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 pointer-events-none text-center w-full px-4">
              <AnimatePresence>
                {gameState.gameOver && !gameState.isGameWon && (
                  <motion.div
                    initial={{ scale: 0.5, opacity: 0, y: 20 }}
                    animate={{ scale: 1, opacity: 1, y: 0 }}
                    exit={{ scale: 1.5, opacity: 0 }}
                    className="flex flex-col items-center"
                  >
                    <div className="bg-white/10 backdrop-blur-md px-6 py-3 sm:px-8 sm:py-4 rounded-2xl sm:rounded-3xl border border-white/20 shadow-2xl">
                      <h2 className="text-3xl sm:text-5xl font-black text-white italic uppercase tracking-tighter">Nice Shot!</h2>
                      <div className="flex items-center justify-center gap-2 mt-1 sm:mt-2">
                        <Trophy className="w-4 h-4 sm:w-5 sm:h-5 text-yellow-400" />
                        <span className="text-xl sm:text-2xl font-bold text-white">Streak: {gameState.streak}</span>
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
      </div>

      {/* Win Screen Overlay */}
      <AnimatePresence>
        {gameState.isGameWon && (
          <motion.div
            key="win-screen"
            initial={{ rotateY: 0, scale: 0.5, opacity: 0 }}
            animate={{ rotateY: 360, scale: 1, opacity: 1 }}
            exit={{ rotateY: 720, scale: 0, opacity: 0 }}
            transition={{ duration: 2, ease: "backOut" }}
            className={`absolute inset-0 flex flex-col items-center justify-center z-[100] ${
              streakGoal === 10 
                ? 'bg-[radial-gradient(circle_at_center,_#FFD700_0%,_#DAA520_50%,_#B8860B_100%)] animate-pulse' 
                : 'bg-yellow-500'
            }`}
          >
            {/* Goat Stampede for Ultimate Win */}
            {streakGoal === 10 && (
              <div className="absolute bottom-10 left-0 w-full overflow-hidden pointer-events-none flex gap-8">
                {[...Array(20)].map((_, i) => (
                  <motion.span
                    key={`stampede-${i}`}
                    initial={{ x: -100 }}
                    animate={{ x: '100vw' }}
                    transition={{ 
                      duration: 3, 
                      repeat: Infinity, 
                      ease: "linear",
                      delay: i * 0.2 
                    }}
                    className="text-6xl"
                  >
                    🐐
                  </motion.span>
                ))}
              </div>
            )}

            <div className="text-white text-center relative z-10 px-4">
              <div className="flex justify-center gap-3 sm:gap-6 mb-6 sm:mb-12">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={`goat-top-${i}`}
                    animate={{ 
                      y: [0, -40, 0],
                      rotate: [-5, 5, -5],
                      scale: [1, 1.1, 1]
                    }}
                    transition={{ 
                      duration: 0.6, 
                      repeat: Infinity, 
                      ease: "easeInOut",
                      delay: i * 0.1 
                    }}
                    className="text-5xl sm:text-8xl drop-shadow-[0_15px_15px_rgba(0,0,0,0.4)]"
                  >
                    {streakGoal === 10 ? '👑🐐' : '🐐'}
                  </motion.span>
                ))}
              </div>
              
              <h1 className="text-5xl sm:text-9xl font-black italic uppercase tracking-tighter mb-1 sm:mb-2 drop-shadow-2xl leading-none">
                {streakGoal === 10 ? 'ULTIMATE' : 'YOU ARE'}
              </h1>
              <h1 className="text-5xl sm:text-9xl font-black italic uppercase tracking-tighter mb-2 sm:mb-4 drop-shadow-2xl leading-none">
                {streakGoal === 10 ? 'GOAT' : 'THE GOAT'}
              </h1>
              
              <div className="flex justify-center gap-3 sm:gap-6 mt-6 sm:mt-12">
                {[0, 1, 2].map((i) => (
                  <motion.span
                    key={`goat-bottom-${i}`}
                    animate={{ 
                      y: [0, -40, 0],
                      rotate: [5, -5, 5],
                      scale: [1, 1.1, 1]
                    }}
                    transition={{ 
                      duration: 0.6, 
                      repeat: Infinity, 
                      ease: "easeInOut",
                      delay: (i + 3) * 0.1 
                    }}
                    className="text-5xl sm:text-8xl drop-shadow-[0_15px_15px_rgba(0,0,0,0.4)]"
                  >
                    {streakGoal === 10 ? '👑🐐' : '🐐'}
                  </motion.span>
                ))}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
