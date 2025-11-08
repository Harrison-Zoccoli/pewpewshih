'use client';

import { useEffect, useRef, useState } from 'react';
import { PoseLandmarker, FilesetResolver } from '@mediapipe/tasks-vision';

interface CameraFeedProps {
  onHit: (targetColor: { r: number; g: number; b: number }) => void;
  showBoundingBoxes: boolean;
  isActive: boolean;
  canvasRef?: React.RefObject<HTMLCanvasElement>;
  onCameraReady?: () => void;
}

type DetectedPerson = {
  boundingBox: {
    x: number;
    y: number;
    width: number;
    height: number;
  };
  color: {
    r: number;
    g: number;
    b: number;
  };
  confidence: number;
};

export default function CameraFeed({ onHit, showBoundingBoxes, isActive, canvasRef: externalCanvasRef, onCameraReady }: CameraFeedProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const internalCanvasRef = useRef<HTMLCanvasElement>(null);
  const canvasRef = externalCanvasRef || internalCanvasRef;
  const [poseLandmarker, setPoseLandmarker] = useState<PoseLandmarker | null>(null);
  const [isModelLoaded, setIsModelLoaded] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const animationFrameRef = useRef<number | undefined>(undefined);
  
  // Store limb hit zones for each person
  const limbHitZonesRef = useRef<Array<{
    circles: Array<{ x: number; y: number; radius: number }>;
    color: { r: number; g: number; b: number };
  }>>([]);

  // Initialize MediaPipe
  useEffect(() => {
    const initializePoseLandmarker = async () => {
      try {
        const vision = await FilesetResolver.forVisionTasks(
          'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@latest/wasm'
        );
        
        const landmarker = await PoseLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath: 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task',
            delegate: 'GPU'
          },
          runningMode: 'VIDEO',
          numPoses: 5, // Detect up to 5 people
          minPoseDetectionConfidence: 0.5,
          minPosePresenceConfidence: 0.5,
          minTrackingConfidence: 0.5
        });
        
        setPoseLandmarker(landmarker);
        setIsModelLoaded(true);
        console.log('MediaPipe PoseLandmarker initialized');
      } catch (error) {
        console.error('Error initializing MediaPipe:', error);
        setCameraError('Failed to load detection model');
      }
    };

    initializePoseLandmarker();
  }, []);

  // Start camera
  useEffect(() => {
    const startCamera = async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: {
            facingMode: 'environment', // Use back camera on mobile
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        });

        if (videoRef.current) {
          videoRef.current.srcObject = stream;
          videoRef.current.onloadedmetadata = async () => {
            console.log('Video metadata loaded');
            try {
              if (videoRef.current) {
                await videoRef.current.play();
                console.log('Camera started successfully');
                setCameraReady(true);
                onCameraReady?.();
              }
            } catch (err) {
              console.error('Error playing video:', err);
              setCameraError('Failed to start camera playback');
            }
          };
        }
      } catch (error) {
        console.error('Error accessing camera:', error);
        setCameraError('Camera access denied. Please enable camera permissions.');
      }
    };

    if (isActive) {
      startCamera();
    }

    return () => {
      // Cleanup camera stream
      if (videoRef.current?.srcObject) {
        const stream = videoRef.current.srcObject as MediaStream;
        stream.getTracks().forEach(track => track.stop());
      }
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [isActive]);

  // Process video frames
  useEffect(() => {
    if (!poseLandmarker || !isModelLoaded || !isActive) {
      console.log('Detection not ready:', { poseLandmarker: !!poseLandmarker, isModelLoaded, isActive });
      return;
    }

    console.log('Starting MediaPipe detection loop with showBoundingBoxes:', showBoundingBoxes);

    const detectPeople = async () => {
      const video = videoRef.current;
      const canvas = canvasRef.current;
      
      if (!video || !canvas) {
        animationFrameRef.current = requestAnimationFrame(detectPeople);
        return;
      }

      if (video.readyState !== 4) {
        animationFrameRef.current = requestAnimationFrame(detectPeople);
        return;
      }

      // Set canvas size to match video
      if (canvas.width !== video.videoWidth || canvas.height !== video.videoHeight) {
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        console.log(`Canvas size set to ${canvas.width}x${canvas.height}`);
      }

      const ctx = canvas.getContext('2d');
      if (!ctx) {
        console.error('Failed to get canvas context');
        animationFrameRef.current = requestAnimationFrame(detectPeople);
        return;
      }

      // Draw video frame
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      // Detect poses
      const startTimeMs = performance.now();
      const results = poseLandmarker.detectForVideo(video, startTimeMs);

      // Process detected people
      const allLimbHitZones: Array<{
        circles: Array<{ x: number; y: number; radius: number }>;
        color: { r: number; g: number; b: number };
      }> = [];

      if (results.landmarks && results.landmarks.length > 0) {
        // Only log occasionally to avoid console spam
        if (Math.random() < 0.05) {
          console.log(`Detected ${results.landmarks.length} people. ShowBoundingBoxes: ${showBoundingBoxes}`);
        }
        for (let i = 0; i < results.landmarks.length; i++) {
          const landmarks = results.landmarks[i];
          
          if (showBoundingBoxes) {
            // Draw skeleton
            drawSkeleton(ctx, landmarks, canvas.width, canvas.height);
            
            // Draw limb bubbles and collect hit zones
            const hitZones = drawLimbBubbles(ctx, landmarks, canvas.width, canvas.height);
            
            // Extract torso color
            const torsoColor = extractTorsoColor(ctx, landmarks, canvas.width, canvas.height);
            
            allLimbHitZones.push({
              circles: hitZones,
              color: torsoColor
            });

            // Draw label
            const xs = landmarks.map(l => l.x * canvas.width);
            const ys = landmarks.map(l => l.y * canvas.height);
            const minX = Math.min(...xs);
            const minY = Math.min(...ys);
            
            ctx.fillStyle = 'rgba(0, 0, 0, 0.7)';
            ctx.fillRect(minX, minY - 30, 100, 25);
            ctx.fillStyle = 'white';
            ctx.font = 'bold 16px Arial';
            ctx.fillText(`Target ${i + 1}`, minX + 5, minY - 10);
          } else {
            // Even if not showing boxes, still track hit zones
            const hitZones = getLimbHitZones(landmarks, canvas.width, canvas.height);
            const torsoColor = extractTorsoColor(ctx, landmarks, canvas.width, canvas.height);
            
            allLimbHitZones.push({
              circles: hitZones,
              color: torsoColor
            });
          }
        }
      }

      // Always draw crosshair
      drawCrosshair(ctx, canvas.width / 2, canvas.height / 2);

      limbHitZonesRef.current = allLimbHitZones;
      animationFrameRef.current = requestAnimationFrame(detectPeople);
    };

    detectPeople();

    return () => {
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
    };
  }, [poseLandmarker, isModelLoaded, isActive, showBoundingBoxes]);

  // Draw skeleton connecting body parts
  const drawSkeleton = (
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    width: number,
    height: number
  ) => {
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x) * width;
    const scale = shoulderWidth / 100;
    
    const connections = [
      [11, 12], [11, 23], [12, 24], [23, 24],
      [11, 13], [13, 15],
      [12, 14], [14, 16],
      [23, 25], [25, 27],
      [24, 26], [26, 28],
    ];

    ctx.strokeStyle = 'rgba(0, 255, 0, 0.5)';
    ctx.lineWidth = 3 * scale;

    connections.forEach(([start, end]) => {
      if (landmarks[start] && landmarks[end]) {
        ctx.beginPath();
        ctx.moveTo(landmarks[start].x * width, landmarks[start].y * height);
        ctx.lineTo(landmarks[end].x * width, landmarks[end].y * height);
        ctx.stroke();
      }
    });
  };

  // Get limb hit zones without drawing (for invisible mode)
  const getLimbHitZones = (
    landmarks: any[],
    width: number,
    height: number
  ): Array<{ x: number; y: number; radius: number }> => {
    const hitZones: Array<{ x: number; y: number; radius: number }> = [];
    
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x) * width;
    const scale = shoulderWidth / 100;
    
    const bodyPoints = [
      { landmark: 0, radius: 50 * scale },
      {
        x: ((landmarks[11].x + landmarks[12].x + landmarks[23].x + landmarks[24].x) / 4) * width,
        y: ((landmarks[11].y + landmarks[12].y + landmarks[23].y + landmarks[24].y) / 4) * height,
        radius: 70 * scale
      },
      { landmark: 11, radius: 35 * scale },
      { landmark: 12, radius: 35 * scale },
      { landmark: 13, radius: 28 * scale },
      { landmark: 14, radius: 28 * scale },
      { landmark: 15, radius: 25 * scale },
      { landmark: 16, radius: 25 * scale },
      { landmark: 23, radius: 38 * scale },
      { landmark: 24, radius: 38 * scale },
      { landmark: 25, radius: 32 * scale },
      { landmark: 26, radius: 32 * scale },
      { landmark: 27, radius: 25 * scale },
      { landmark: 28, radius: 25 * scale },
    ];

    bodyPoints.forEach((point) => {
      let x, y;
      
      if ('landmark' in point && point.landmark !== undefined) {
        x = landmarks[point.landmark].x * width;
        y = landmarks[point.landmark].y * height;
      } else {
        x = point.x!;
        y = point.y!;
      }
      
      hitZones.push({ x, y, radius: point.radius });
    });
    
    return hitZones;
  };

  // Draw bubbles around limbs
  const drawLimbBubbles = (
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    width: number,
    height: number
  ): Array<{ x: number; y: number; radius: number }> => {
    const hitZones: Array<{ x: number; y: number; radius: number }> = [];
    
    const leftShoulder = landmarks[11];
    const rightShoulder = landmarks[12];
    const shoulderWidth = Math.abs(rightShoulder.x - leftShoulder.x) * width;
    const scale = shoulderWidth / 100;
    
    const bodyPoints = [
      { 
        landmark: 0,
        radius: 50 * scale,
        color: 'rgba(255, 200, 0, 0.3)',
        stroke: 'rgba(255, 200, 0, 0.6)'
      },
      {
        x: ((landmarks[11].x + landmarks[12].x + landmarks[23].x + landmarks[24].x) / 4) * width,
        y: ((landmarks[11].y + landmarks[12].y + landmarks[23].y + landmarks[24].y) / 4) * height,
        radius: 70 * scale,
        color: 'rgba(255, 100, 100, 0.25)',
        stroke: 'rgba(255, 100, 100, 0.5)'
      },
      { landmark: 11, radius: 35 * scale, color: 'rgba(0, 200, 255, 0.2)', stroke: 'rgba(0, 200, 255, 0.5)' },
      { landmark: 12, radius: 35 * scale, color: 'rgba(0, 200, 255, 0.2)', stroke: 'rgba(0, 200, 255, 0.5)' },
      { landmark: 13, radius: 28 * scale, color: 'rgba(0, 200, 255, 0.2)', stroke: 'rgba(0, 200, 255, 0.5)' },
      { landmark: 14, radius: 28 * scale, color: 'rgba(0, 200, 255, 0.2)', stroke: 'rgba(0, 200, 255, 0.5)' },
      { landmark: 15, radius: 25 * scale, color: 'rgba(0, 200, 255, 0.2)', stroke: 'rgba(0, 200, 255, 0.5)' },
      { landmark: 16, radius: 25 * scale, color: 'rgba(0, 200, 255, 0.2)', stroke: 'rgba(0, 200, 255, 0.5)' },
      { landmark: 23, radius: 38 * scale, color: 'rgba(255, 100, 100, 0.2)', stroke: 'rgba(255, 100, 100, 0.5)' },
      { landmark: 24, radius: 38 * scale, color: 'rgba(255, 100, 100, 0.2)', stroke: 'rgba(255, 100, 100, 0.5)' },
      { landmark: 25, radius: 32 * scale, color: 'rgba(0, 200, 255, 0.2)', stroke: 'rgba(0, 200, 255, 0.5)' },
      { landmark: 26, radius: 32 * scale, color: 'rgba(0, 200, 255, 0.2)', stroke: 'rgba(0, 200, 255, 0.5)' },
      { landmark: 27, radius: 25 * scale, color: 'rgba(0, 200, 255, 0.2)', stroke: 'rgba(0, 200, 255, 0.5)' },
      { landmark: 28, radius: 25 * scale, color: 'rgba(0, 200, 255, 0.2)', stroke: 'rgba(0, 200, 255, 0.5)' },
    ];

    bodyPoints.forEach((point) => {
      let x, y;
      
      if ('landmark' in point && point.landmark !== undefined) {
        x = landmarks[point.landmark].x * width;
        y = landmarks[point.landmark].y * height;
      } else {
        x = point.x!;
        y = point.y!;
      }
      
      ctx.fillStyle = point.color;
      ctx.strokeStyle = point.stroke;
      ctx.lineWidth = 2;
      
      ctx.beginPath();
      ctx.arc(x, y, point.radius, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      
      hitZones.push({ x, y, radius: point.radius });
    });
    
    return hitZones;
  };

  // Draw crosshair at center of screen
  const drawCrosshair = (ctx: CanvasRenderingContext2D, x: number, y: number) => {
    const size = 20;
    const gap = 5;
    
    ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
    ctx.lineWidth = 3;
    ctx.shadowColor = 'black';
    ctx.shadowBlur = 4;

    ctx.beginPath();
    ctx.moveTo(x - size, y);
    ctx.lineTo(x - gap, y);
    ctx.moveTo(x + gap, y);
    ctx.lineTo(x + size, y);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x, y - size);
    ctx.lineTo(x, y - gap);
    ctx.moveTo(x, y + gap);
    ctx.lineTo(x, y + size);
    ctx.stroke();

    ctx.fillStyle = 'rgba(255, 0, 0, 0.9)';
    ctx.beginPath();
    ctx.arc(x, y, 3, 0, 2 * Math.PI);
    ctx.fill();
    
    ctx.shadowBlur = 0;
  };

  // Extract dominant color from torso region
  const extractTorsoColor = (
    ctx: CanvasRenderingContext2D,
    landmarks: any[],
    width: number,
    height: number
  ): { r: number; g: number; b: number } => {
    try {
      const leftShoulder = landmarks[11];
      const rightShoulder = landmarks[12];
      const leftHip = landmarks[23];
      const rightHip = landmarks[24];

      const torsoX = Math.min(leftShoulder.x, rightShoulder.x) * width;
      const torsoY = leftShoulder.y * height;
      const torsoWidth = Math.abs(rightShoulder.x - leftShoulder.x) * width;
      const torsoHeight = Math.abs(leftHip.y - leftShoulder.y) * height;

      const imageData = ctx.getImageData(
        Math.max(0, torsoX),
        Math.max(0, torsoY),
        Math.min(torsoWidth, width),
        Math.min(torsoHeight, height)
      );

      let r = 0, g = 0, b = 0;
      const pixels = imageData.data.length / 4;

      for (let i = 0; i < imageData.data.length; i += 4) {
        r += imageData.data[i];
        g += imageData.data[i + 1];
        b += imageData.data[i + 2];
      }

      return {
        r: Math.round(r / pixels),
        g: Math.round(g / pixels),
        b: Math.round(b / pixels)
      };
    } catch (error) {
      return { r: 128, g: 128, b: 128 };
    }
  };

  // Handle tap/click - uses crosshair position and limb hit zones
  const handleCanvasClick = () => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const x = canvas.width / 2;
    const y = canvas.height / 2;

    const hitZones = limbHitZonesRef.current;
    
    for (let i = 0; i < hitZones.length; i++) {
      const person = hitZones[i];
      
      for (const circle of person.circles) {
        const distance = Math.sqrt(
          Math.pow(x - circle.x, 2) + Math.pow(y - circle.y, 2)
        );
        
        if (distance <= circle.radius) {
          onHit(person.color);
          
          // Visual feedback
          const ctx = canvas.getContext('2d');
          if (ctx) {
            ctx.fillStyle = 'rgba(255, 255, 0, 0.8)';
            ctx.beginPath();
            ctx.arc(x, y, 40, 0, 2 * Math.PI);
            ctx.fill();
            
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.9)';
            ctx.lineWidth = 4;
            const markerSize = 15;
            
            ctx.beginPath();
            ctx.moveTo(x - markerSize, y - markerSize);
            ctx.lineTo(x + markerSize, y + markerSize);
            ctx.moveTo(x + markerSize, y - markerSize);
            ctx.lineTo(x - markerSize, y + markerSize);
            ctx.stroke();
            
            ctx.strokeStyle = 'rgba(255, 0, 0, 0.8)';
            ctx.lineWidth = 4;
            ctx.beginPath();
            ctx.arc(circle.x, circle.y, circle.radius, 0, 2 * Math.PI);
            ctx.stroke();
          }
          
          return;
        }
      }
    }
  };

  if (cameraError) {
    return (
      <div className="flex h-full items-center justify-center bg-gray-900 text-white p-4">
        <div className="text-center">
          <p className="text-xl mb-2 text-white">⚠️ Camera Error</p>
          <p className="text-sm text-white">{cameraError}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full aspect-video bg-black">
      <video
        ref={videoRef}
        autoPlay
        playsInline
        muted
        className="absolute inset-0 w-full h-full object-cover hidden"
      />
      <canvas
        ref={canvasRef}
        onClick={handleCanvasClick}
        className="absolute inset-0 w-full h-full object-cover cursor-crosshair touch-none"
      />
      
      {!cameraReady && !cameraError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 text-white">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-white">Starting camera...</p>
          </div>
        </div>
      )}
      
      {!isModelLoaded && cameraReady && (
        <div className="absolute inset-0 flex items-center justify-center bg-black bg-opacity-75 text-white">
          <div className="text-center">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-white mx-auto mb-4"></div>
            <p className="text-white">Loading detection model...</p>
          </div>
        </div>
      )}
    </div>
  );
}

