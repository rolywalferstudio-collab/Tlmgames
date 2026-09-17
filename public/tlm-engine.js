import * as THREE from 'https://unpkg.com/three@0.160.0/build/three.module.js';
import * as CANNON from 'https://cdn.jsdelivr.net/npm/cannon-es@0.20.0/+esm';
import { GLTFLoader } from 'https://unpkg.com/three@0.160.0/examples/jsm/loaders/GLTFLoader.js';

export class TLMEngine {
    constructor(container) {
        this.container = container;

        // Scène & Caméra
        this.scene = new THREE.Scene();
        this.scene.background = new THREE.Color(0x68b0d8);

        this.camera = new THREE.PerspectiveCamera(75, container.clientWidth / container.clientHeight, 0.1, 1000);
        this.camera.position.set(0, 10, 20);

        this.renderer = new THREE.WebGLRenderer({ antialias: true });
        this.renderer.setSize(container.clientWidth, container.clientHeight);
        this.renderer.shadowMap.enabled = true;
        this.container.appendChild(this.renderer.domElement);

        // Physique
        this.world = new CANNON.World({ gravity: new CANNON.Vec3(0, -9.82, 0) });

        // Utilitaires
        this.gltfLoader = new GLTFLoader();
        this.textureLoader = new THREE.TextureLoader();
        this.raycaster = new THREE.Raycaster();
        this.mouse = new THREE.Vector2();
        this.gameObjects = new Map();
        this.selectedObject = null;
        this.onSelectCallback = null;

        // Joueur
        this.player = {
            isPlaying: false,
            mesh: null,
            body: null,
            speed: 8,
            jumpForce: 5,
            keys: { forward: false, backward: false, left: false, right: false, jump: false }
        };

        this.initLights();
        this.initEvents();
    }

    initLights() {
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
        this.scene.add(ambientLight);

        const sun = new THREE.DirectionalLight(0xffffff, 0.9);
        sun.position.set(20, 40, 20);
        sun.castShadow = true;
        this.scene.add(sun);
    }

    initEvents() {
        window.addEventListener('resize', () => this.onWindowResize());
        this.container.addEventListener('pointerdown', (e) => this.onPointerDown(e));
        window.addEventListener('keydown', (e) => this.handleKey(e, true));
        window.addEventListener('keyup', (e) => this.handleKey(e, false));
    }

    // Création de matériaux Toon (style cartoon)
    createToonMaterial(color = 0x00ff00, textureUrl = null) {
        const colors = new Uint8Array([0, 128, 255]);
        const gradientMap = new THREE.DataTexture(colors, 3, 1, THREE.RedFormat);
        gradientMap.needsUpdate = true;

        const matParams = {
            color: color,
            gradientMap: gradientMap
        };

        if (textureUrl) {
            matParams.map = this.textureLoader.load(textureUrl);
        }

        return new THREE.MeshToonMaterial(matParams);
    }

    createPart(params = {}) {
        const {
            id = crypto.randomUUID(),
            type = 'box',
            size = [2, 2, 2],
            position = [0, 1, 0],
            rotation = [0, 0, 0],
            color = 0x00ff00,
            anchored = false
        } = params;

        let geometry;
        let shape;

        if (type === 'sphere') {
            geometry = new THREE.SphereGeometry(size[0] / 2, 32, 32);
            shape = new CANNON.Sphere(size[0] / 2);
        } else if (type === 'ramp') {
            geometry = new THREE.CylinderGeometry(0, size[0], size[1], 4);
            shape = new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2));
        } else {
            geometry = new THREE.BoxGeometry(...size);
            shape = new CANNON.Box(new CANNON.Vec3(size[0] / 2, size[1] / 2, size[2] / 2));
        }

        const material = this.createToonMaterial(color);
        const mesh = new THREE.Mesh(geometry, material);
        mesh.position.set(...position);
        mesh.rotation.set(...rotation);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.scene.add(mesh);

        const body = new CANNON.Body({
            mass: anchored ? 0 : 1,
            position: new CANNON.Vec3(...position)
        });
        body.addShape(shape);
        this.world.addBody(body);

        const objectData = { id, mesh, body, anchored, script: '' };
        this.gameObjects.set(id, objectData);

        return objectData;
    }

    loadGLTFModel(url, position = [0, 2, 0]) {
        this.gltfLoader.load(url, (gltf) => {
            const model = gltf.scene;
            model.position.set(...position);

            model.traverse((child) => {
                if (child.isMesh) {
                    child.castShadow = true;
                    child.receiveShadow = true;
                }
            });

            this.scene.add(model);

            const id = crypto.randomUUID();
            const shape = new CANNON.Box(new CANNON.Vec3(1, 1, 1));
            const body = new CANNON.Body({ mass: 0, position: new CANNON.Vec3(...position) });
            body.addShape(shape);
            this.world.addBody(body);

            const objectData = { id, mesh: model, body, anchored: true, isModel: true, script: '' };
            this.gameObjects.set(id, objectData);
        });
    }

    onSelect(callback) {
        this.onSelectCallback = callback;
    }

    onPointerDown(event) {
        if (this.player.isPlaying) return;

        const rect = this.container.getBoundingClientRect();
        this.mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
        this.mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

        this.raycaster.setFromCamera(this.mouse, this.camera);
        const meshes = Array.from(this.gameObjects.values()).map(o => o.mesh);
        const intersects = this.raycaster.intersectObjects(meshes, true);

        if (intersects.length > 0) {
            let hitObj = intersects[0].object;
            while (hitObj.parent && hitObj.parent.type !== 'Scene') {
                if (Array.from(this.gameObjects.values()).some(o => o.mesh === hitObj)) break;
                hitObj = hitObj.parent;
            }

            for (const [id, obj] of this.gameObjects.entries()) {
                if (obj.mesh === hitObj) {
                    this.selectObject(id);
                    return;
                }
            }
        } else {
            this.selectObject(null);
        }
    }

    selectObject(id) {
        if (this.selectedObject && this.selectedObject.mesh.material) {
            this.selectedObject.mesh.material.emissive?.setHex(0x000000);
        }

        if (id && this.gameObjects.has(id)) {
            this.selectedObject = this.gameObjects.get(id);
            if (this.selectedObject.mesh.material) {
                this.selectedObject.mesh.material.emissive?.setHex(0x444444);
            }
            if (this.onSelectCallback) this.onSelectCallback(this.selectedObject);
        } else {
            this.selectedObject = null;
            if (this.onSelectCallback) this.onSelectCallback(null);
        }
    }

    updateSelectedProperty(prop, value) {
        if (!this.selectedObject) return;
        const obj = this.selectedObject;

        if (prop === 'color' && obj.mesh.material) {
            obj.mesh.material.color.set(value);
        } else if (prop === 'anchored') {
            obj.anchored = value;
            obj.body.mass = value ? 0 : 1;
            obj.body.updateMassProperties();
        } else if (prop.startsWith('position.')) {
            const axis = prop.split('.')[1];
            obj.mesh.position[axis] = parseFloat(value);
            obj.body.position[axis] = parseFloat(value);
        } else if (prop.startsWith('rotation.')) {
            const axis = prop.split('.')[1];
            obj.mesh.rotation[axis] = THREE.MathUtils.degToRad(parseFloat(value));
        } else if (prop.startsWith('scale.')) {
            const axis = prop.split('.')[1];
            obj.mesh.scale[axis] = parseFloat(value);
        }
    }

    deleteSelected() {
        if (!this.selectedObject) return;
        const id = this.selectedObject.id;
        this.scene.remove(this.selectedObject.mesh);
        this.world.removeBody(this.selectedObject.body);
        this.gameObjects.delete(id);
        this.selectObject(null);
    }

    handleKey(event, isPressed) {
        switch (event.code) {
            case 'KeyW': case 'ArrowUp': this.player.keys.forward = isPressed; break;
            case 'KeyS': case 'ArrowDown': this.player.keys.backward = isPressed; break;
            case 'KeyA': case 'ArrowLeft': this.player.keys.left = isPressed; break;
            case 'KeyD': case 'ArrowRight': this.player.keys.right = isPressed; break;
            case 'Space': this.player.keys.jump = isPressed; break;
        }
    }

    togglePlayMode() {
        this.player.isPlaying = !this.player.isPlaying;

        if (this.player.isPlaying) {
            this.selectObject(null);

            const geometry = new THREE.CapsuleGeometry(0.5, 1, 4, 8);
            const material = this.createToonMaterial(0xff0000);
            this.player.mesh = new THREE.Mesh(geometry, material);
            this.player.mesh.castShadow = true;
            this.scene.add(this.player.mesh);

            const shape = new CANNON.Sphere(0.5);
            this.player.body = new CANNON.Body({
                mass: 70,
                position: new CANNON.Vec3(0, 5, 0),
                fixedRotation: true
            });
            this.player.body.addShape(shape);
            this.world.addBody(this.player.body);
        } else {
            if (this.player.mesh) this.scene.remove(this.player.mesh);
            if (this.player.body) this.world.removeBody(this.player.body);
            this.player.mesh = null;
            this.player.body = null;

            this.camera.position.set(0, 10, 20);
            this.camera.lookAt(0, 0, 0);
        }

        return this.player.isPlaying;
    }

    updatePlayer() {
        if (!this.player.isPlaying || !this.player.body) return;

        let moveX = 0, moveZ = 0;
        if (this.player.keys.forward) moveZ -= 1;
        if (this.player.keys.backward) moveZ += 1;
        if (this.player.keys.left) moveX -= 1;
        if (this.player.keys.right) moveX += 1;

        const vector = new THREE.Vector3(moveX, 0, moveZ).normalize();
        this.player.body.velocity.x = vector.x * this.player.speed;
        this.player.body.velocity.z = vector.z * this.player.speed;

        if (this.player.keys.jump && Math.abs(this.player.body.velocity.y) < 0.05) {
            this.player.body.velocity.y = this.player.jumpForce;
        }

        this.player.mesh.position.copy(this.player.body.position);

        this.camera.position.set(
            this.player.mesh.position.x,
            this.player.mesh.position.y + 4,
            this.player.mesh.position.z + 8
        );
        this.camera.lookAt(this.player.mesh.position);
    }

    start() {
        const timeStep = 1 / 60;
        let lastTime;

        const animate = (time) => {
            requestAnimationFrame(animate);

            if (lastTime !== undefined) {
                const dt = (time - lastTime) / 1000;
                this.world.step(timeStep, dt);

                if (this.player.isPlaying) {
                    this.updatePlayer();
                }

                for (const obj of this.gameObjects.values()) {
                    if (!obj.anchored && obj.body) {
                        obj.mesh.position.copy(obj.body.position);
                        obj.mesh.quaternion.copy(obj.body.quaternion);
                    }
                }
            }

            lastTime = time;
            this.renderer.render(this.scene, this.camera);
        };

        animate();
    }

    exportScene() {
        const data = [];
        for (const [id, obj] of this.gameObjects.entries()) {
            data.push({
                id,
                position: [obj.mesh.position.x, obj.mesh.position.y, obj.mesh.position.z],
                rotation: [obj.mesh.rotation.x, obj.mesh.rotation.y, obj.mesh.rotation.z],
                color: obj.mesh.material?.color ? obj.mesh.material.color.getHex() : 0xffffff,
                anchored: obj.anchored,
                script: obj.script
            });
        }
        return JSON.stringify(data);
    }

    onWindowResize() {
        this.camera.aspect = this.container.clientWidth / this.container.clientHeight;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(this.container.clientWidth, this.container.clientHeight);
    }
          }
