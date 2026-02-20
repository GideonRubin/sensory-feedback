import { useRef } from 'react'
import { Canvas, useFrame } from '@react-three/fiber'
import { OrbitControls, Environment, ContactShadows } from '@react-three/drei'
import * as THREE from 'three'

// Sensor indices: 0: RF, 1: LF, 2: RB, 3: LB

interface WalkingModelProps {
  sensors: number[]; // Array of 4 values [RF, LF, RB, LB]
}

const Shoe = ({ side, sensors, position }: { side: 'left' | 'right', sensors: number[], position: [number, number, number] }) => {
  const groupRef = useRef<THREE.Group>(null)
  
  // Indices for this foot
  const frontIdx = side === 'right' ? 0 : 1
  const backIdx = side === 'right' ? 2 : 3
  
  const frontPressure = sensors[frontIdx] || 0
  const backPressure = sensors[backIdx] || 0
  const totalPressure = frontPressure + backPressure
  
  // Calculate target height
  const liftFactor = Math.max(0, 1 - (totalPressure / 20)); 
  const targetY = liftFactor * 0.4 + 0.1; // Reduced lift height for compactness
  
  // Tilt Calculation (Pitch)
  let targetRotationX = 0;
  if (totalPressure > 10) {
      if (backPressure > frontPressure + 10) {
          // Heel strike
          targetRotationX = -0.3; 
      } else if (frontPressure > backPressure + 10) {
          // Toe off
          targetRotationX = 0.4;
      }
  }

  useFrame((_state, delta) => {
    if (groupRef.current) {
        // Smooth interpolation
        groupRef.current.position.y = THREE.MathUtils.lerp(groupRef.current.position.y, targetY, delta * 15)
        groupRef.current.rotation.x = THREE.MathUtils.lerp(groupRef.current.rotation.x, targetRotationX, delta * 15)
    }
  })

  // Color changing based on pressure
  const color = side === 'right' ? '#ea580c' : '#2563eb' // Darker shades for main body

  return (
    <group ref={groupRef} position={position}>
      {/* Simple 2-part Shoe Model */}
      
      {/* Base: Horizontal Capsule - Rotated to face Front (Z-axis) */}
      <mesh position={[0, 0.1, 0]} rotation={[Math.PI / 2, 0, 0]}> 
         <capsuleGeometry args={[0.22, 0.6, 4, 16]} /> 
         <meshStandardMaterial color={color} roughness={1.0} />
      </mesh>
      
      {/* Ankle: Vertical Capsule/Cylinder - shifted back and up */}
      <mesh position={[0, 0.3, -0.35]}>
         <capsuleGeometry args={[0.16, 0.25, 4, 16]} />
         <meshStandardMaterial color={color} roughness={1.0} />
      </mesh>
    </group>
  )
}


export function WalkingModel({ sensors, camera = [2, 2, 4], fov = 45, modelPosition = [0, -0.5, 0] }: WalkingModelProps & { camera?: [number, number, number], fov?: number, modelPosition?: [number, number, number] }) {
  return (
    <div className="w-full h-full">
      <Canvas shadows camera={{ position: camera, fov: fov }}>
        <ambientLight intensity={0.7} />
        <pointLight position={[10, 10, 10]} intensity={1} castShadow />
        <Environment preset="city" />
        
        <group position={modelPosition}>
            {/* Right Shoe */}
            <Shoe side="right" sensors={sensors} position={[0.5, 0, 0]} />
            
            {/* Left Shoe */}
            <Shoe side="left" sensors={sensors} position={[-0.5, 0, 0]} />

            <ContactShadows position={[0, 0, 0]} opacity={0.4} scale={10} blur={2.5} far={1} />
        </group>
        
        <OrbitControls enablePan={true} enableZoom={true} minPolarAngle={Math.PI / 4} maxPolarAngle={Math.PI / 2} />
      </Canvas>
    </div>
  )
}
