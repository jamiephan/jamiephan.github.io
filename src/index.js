import * as THREE from 'three';
import "./styles/style.css"
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

// Textures

import MoonTexture from "./assets/moon_texture.jpg";
// import MoonNormalMap from "./assets/moon_normalmap.jpg";

import EarthTexture from "./assets/earth_texture.jpg";
// import EarthNormalMap from "./assets/earth_normalmap.jpg";

import bg_px from "./assets/px.jpg"
import bg_nx from "./assets/nx.jpg"
import bg_py from "./assets/py.jpg"
import bg_ny from "./assets/ny.jpg"
import bg_pz from "./assets/pz.jpg"
import bg_nz from "./assets/nz.jpg"

const minDistance = 25
const maxDistance = 50
const worldSize = 1000
let enableMousePan = true
const mousePanSlowness = 500
const mousePanThreshold = 200
let discoveredEasterEgg = false
let savedElement = null

const degreeToRadian = (deg) => deg * (Math.PI / 180)

// Scene
const scene = new THREE.Scene()

// Camera
const camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 1, worldSize)
camera.position.set(0, minDistance * -1, 0)


// Lighting 
const ambientLight = new THREE.AmbientLight(0xffffff);


// Objects

// Stars
const starCount = 1500
const starColors = [0xffffff, 0xe0fdff, 0xfcffde, 0xffeded, 0xfff3eb, 0xeeffe3, 0xe3eaff, 0xf1e3ff, 0xffe3fd]

for (let i = 0; i < starCount; i++) {
  const geometry = new THREE.SphereGeometry(0.05, 24, 24);
  const material = new THREE.MeshStandardMaterial({ color: starColors[Math.floor(Math.random() * starColors.length)] });
  const star = new THREE.Mesh(geometry, material);
  const [x, y, z] = Array(3)
    .fill()
    .map(() => THREE.MathUtils.randFloatSpread(70));

  star.position.set(x, y, z);
  scene.add(star);
}

// Moon
const moon = new THREE.Mesh(
  new THREE.SphereGeometry(1.5, 32, 32),
  new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load(MoonTexture),
    // normalMap: new THREE.TextureLoader().load(MoonNormalMap)
  })
)

moon.rotation.set(-30, 60, 50)
moon.position.set(10, -3, 6)


// Earth
const earth = new THREE.Mesh(
  new THREE.SphereGeometry(4, 64, 64),
  new THREE.MeshStandardMaterial({
    map: new THREE.TextureLoader().load(EarthTexture),
    // normalMap: new THREE.TextureLoader().load(EarthNormalMap)
  })
)
earth.rotation.set(degreeToRadian(90), degreeToRadian(-90), 0)


// Skybox
const background = new THREE.Mesh(
  new THREE.BoxGeometry(worldSize, worldSize, worldSize),
  [bg_px, bg_nx, bg_py, bg_ny, bg_pz, bg_nz,]
    .map(t => new THREE.TextureLoader().load(t))
    .map(tl => new THREE.MeshBasicMaterial({
      map: tl,
      side: THREE.BackSide
    }))
)


// Add Objects to the scene
scene.add(ambientLight);
scene.add(moon, earth)
scene.add(background)



// Renderer
const renderer = new THREE.WebGLRenderer({
  canvas: document.getElementById("background"),
  antialias: true,
})

renderer.setPixelRatio(window.devicePixelRatio);
renderer.setSize(window.innerWidth, window.innerHeight);


const control = new OrbitControls(camera, renderer.domElement);
control.enabled = false
control.maxDistance = maxDistance

const randomRotation = (obj, maxDegree = 10) => {
  obj.rotation.x -= Math.random() * degreeToRadian(maxDegree);
  obj.rotation.y -= Math.random() * degreeToRadian(maxDegree);
  obj.rotation.z -= Math.random() * degreeToRadian(maxDegree);
}

const sceneAutoRotate = (degree, positive = false) => {
  scene.rotation.x += degreeToRadian(degree) * (positive ? 1 : -1);
  scene.rotation.y += degreeToRadian(degree) * (positive ? 1 : -1);
  scene.rotation.z += degreeToRadian(degree) * (positive ? 1 : -1);
}




// Event Handler


// Window Resize
document.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
}, false)


// Move scene a bit when mouse move
let previousX = 0
let previousY = 0

document.addEventListener("mousemove", e => {

  if (!enableMousePan) return

  const x = e.offsetX
  const y = e.offsetY

  if (Math.abs(previousX - x) >= mousePanThreshold) {
    previousX = x
  } else {
    scene.rotateZ(degreeToRadian(Math.abs(previousX - x) / mousePanSlowness) * (previousX - x < 0 ? 1 : -1))
    previousX = x
  }

  if (Math.abs(previousY - y) >= mousePanThreshold) {
    previousY = y
  } else {
    scene.rotateX(degreeToRadian(Math.abs(previousY - y) / mousePanSlowness) * (previousY - y < 0 ? 1 : -1))
    previousY = y
  }
})

// Key Down Events

document.addEventListener("keydown", e => {

  if (e.shiftKey && e.key === 'Q') {
    alert(
      [
        "Hehe, You found me!",
        "You can now fully control the universe!",
        "",
        "Mouse Wheel = Zoom In/Out",
        "Left Mouse Drag = Rotate",
        "Right Mouse Drag = Pan",
        "Ctrl + Q = Reset the Camera Angel",
        "Alt + Q = Restore the text and remove this Easter Egg",
        "",
        "Press the key combination again to show this message!"
      ].join("\n")
    )

    if (!discoveredEasterEgg) {
      // First time
      document.querySelector("main").classList.add("hide")
      savedElement = document.querySelector("main").innerHTML
      setTimeout(() => document.querySelector("main").innerHTML = "", 500)

      discoveredEasterEgg = true
      control.enabled = true
      enableMousePan = false
    }
    return
  }

  // Must have easter egg enabled below
  if (discoveredEasterEgg) {

    if (e.altKey && e.key === 'q') {
      // Remove Easter Egg

      document.querySelector("main").innerHTML = savedElement
      document.querySelector("main").classList.remove("hide")

      control.reset();
      control.enabled = false
      discoveredEasterEgg = false
      enableMousePan = true
      return
    }

    if (e.ctrlKey && e.key === 'q') {
      // Reset Scene and Camera
      control.reset();
      return
    }
  }

})


// Zoom out when scrolling
document.addEventListener("scroll", () => {

  const documentTotalHeight = document.documentElement.scrollHeight
  const documentCurrentHeight = document.body.getBoundingClientRect().top * -1
  const documentScrollPercentage = documentCurrentHeight / documentTotalHeight
  const distance = ((maxDistance - minDistance) * documentScrollPercentage) + minDistance

  camera.position.y = distance * -1

})


// Animation Loop

const loop = () => {
  // Render on each paint
  requestAnimationFrame(loop)

  if (control.enabled) control.update()

  if (!discoveredEasterEgg) {
    
    // Apply rotation to the scene
    sceneAutoRotate(0.015)

    // Moon Rotation
    moon.rotateY(degreeToRadian(.065))
    moon.rotateX(degreeToRadian(-.065))
  
    // Earth Rotation
    earth.rotateY(degreeToRadian(.3))
  }


  // Render the scene
  renderer.render(scene, camera)
}

loop()


