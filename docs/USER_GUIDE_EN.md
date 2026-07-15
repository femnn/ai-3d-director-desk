# AI 3D Director Desk User Guide

## 1. Start the Director Desk

On macOS, double-click `启动3D导演台.command`. To run from source:

```bash
npm install
npm run dev
```

Wait until the terminal prints the `Director desk` URL. Keep the terminal or desktop application running while using the tool.

## 2. Build a Scene

- Use the bottom toolbar to add characters, crowd groups, geometry, models, and cameras.
- Select an object in the left object tree, then edit position, rotation, scale, pose, and animation in the right inspector.
- Delete selected objects with the visible delete control or `Delete / Backspace`.
- Toggle the ground grid in scene settings.
- Use complete project JSON when imported FBX, OBJ, GLB, or panorama assets must be restored.

## 3. Build Scenes with an Agent

Open the AI scene panel and execute JSON that follows the `apply_scene_script` schema. A good scene plan describes character relationships, prop relationships, blocking, framing, and lens choices before generating the command.

Export complete project JSON before large changes. Scene commands are useful for quickly restoring or revising supported characters, geometry, cameras, and camera animations.

Scene commands use a strict tool whitelist and never execute arbitrary JavaScript.

## 4. Join with Multiple Phones

1. Connect the phones and computer to the same Wi-Fi or reachable local network.
2. Scan the QR code displayed in the director desk.
3. The first phone receives a camera. New phones prefer available cameras and create new cameras when needed.
4. Use the `My Camera` bar at the top of the phone UI to switch between cameras assigned to that phone.
5. Do not assign multiple phones to the same occupied camera during a multi-user session.

Fullscreen mode requests landscape orientation. Browsers that cannot lock orientation use the responsive landscape control layout instead.

## 5. Control the Virtual Camera

- Left joystick: dolly forward/backward and truck left/right.
- Drag the live monitor: pan and tilt the camera.
- Height: pedestal the camera up or down.
- FOV: adjust the lens field of view.
- Reset: restore the camera's calibrated baseline.
- Motion mode: controls orientation on supported secure browser contexts. Reliable browser-based 6DoF positional tracking is not assumed.

The phone monitor is read-only scene output. Touch input controls the camera and does not select scene objects.

## 6. Pose and Animate Characters

- Use the Pose tab for a static pose, a pose preset, or direct rig editing.
- Use the Animation tab for looping presets and 5, 10, or 15-second loops.
- Open the unified timeline from the viewport toolbar to synchronize character, group, and child-part tracks.
- The only playback modes are Manual, During Recording, and Follow Camera Motion. Loop is a separate switch.
- In Follow Camera Motion mode, the sequence advances while the recorded camera moves and pauses about 200ms after it stops.
- Upload a person video to extract motion or a full-body image to extract a single pose. Results depend on visibility, occlusion, and camera angle.
- Text-generated motion requires an available local or remote AnimoFlow service.

## 7. Record and Export Video

1. Select 5, 10, or 15 seconds on the phone.
2. Start recording and operate the camera. The camera path and raw live monitor video are saved together.
3. Confirm that the desktop camera animation list reports the original recording as ready.
4. Export MP4. The scene is not replayed a second time during packaging.

Keep the director desk visible while recording so the browser or operating system does not throttle rendering. For complex scenes, reduce model count and texture size to protect the live frame rate.

## 8. Save, Import, and Reset

- **Project JSON**: complete backup for scene assets, edited poses, animations, cameras, and imported files.
- **Scene Command JSON**: agent-friendly representation for fast scene reconstruction and revision.
- **Character Animation JSON**: `storyai-character-animation` adds dancers or fighters and their animation to the current scene without replacing existing props, cameras, or environment.
- **Reset Director Desk**: restore one default character and one basic camera without deleting exported files.

Importing a complete scene command replaces the current director desk. Manual sequences loop by default; recording sequences start from frame zero when monitor capture actually begins.

Wait for imported assets to finish loading before starting phone recording.

## 9. Windows Troubleshooting

Windows x64 users can install the Setup build or run the Portable build. If Windows protection blocks the first launch, verify the download source before choosing to continue.

Application logs are stored at:

```text
%APPDATA%\AI影视导演台\logs\director-desk.log
```

Check that the installation directory is writable, the firewall allows private-network access, no other instance is using the local port, and Windows is 64-bit and updated.

## 10. Development Commands

```bash
npm run dev
npm test
npm run build
npm run package:mac
npm run package:win
```
