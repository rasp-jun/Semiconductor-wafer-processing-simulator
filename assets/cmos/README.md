# WaferFlow AXIS — equipment studies, edition 03

18 educational equipment studies authored for this project with Blender Python. Public equipment photographs and manufacturer descriptions informed the enclosure families, load ports, service cabinets and module arrangements. These are original illustrative geometry, not vendor CAD, exact dimensions or calibrated digital twins. Vendor photographs and logos are not embedded in these assets. See `cmos-equipment-catalog.js` for each tool's official reference and explanatory scope, reviewed 2026-09-28.

The default view presents the industrial enclosure. **내부 구조** removes it and reveals the educational mechanisms: wafer, robot, gates, lifts, stages and effects. Both views share the same processing state. **공정실 확대** and **웨이퍼** camera modes open the internal view automatically.

## Distinct architectures

Edition 03 replaces the shared wide front end with tool-specific load-port placement, body proportions and process modules. The active wafer seat, animated mechanisms and process model remain aligned with the existing simulation. Public reference photographs informed the equipment families; window placement, module counts and arrangement are original educational choices, not specifications of the linked vendor products.

| Tool | Distinguishing geometry |
|---|---|
| Clean | Tall glazed transfer bay, three exhaust risers, fluid service column |
| Wet etch | Long chemical deck, amber hood, separate fume exhaust |
| Oxidation | Single tall thermal tower, boat elevator recess, thermal-zone bands |
| LPCVD | Twin cylindrical furnace shields, vacuum manifold and gas tower |
| Coat | Round spin-cup canopy, stepped resist cartridge bank |
| Develop | Long stacked three-bay track with inspection windows |
| Bake | Six thermal drawers and offset chill plate |
| Scanner | Tall blue optical bridge, reticle crown, isolated wide stage |
| Etch | Faceted hub, radial ICP vessels and copper source coils |
| Strip | Two remote plasma towers and radical delivery arches |
| PECVD | Wide four-station drum, separate showerhead lids, RF racks |
| ALD | Paired precursor ampoules, heated lines, vertical valve cabinet |
| Implant | Extended segmented beamline, magnet housing, cylindrical end station |
| RTP | Circular lamp crown, reflector window and pyrometer mast |
| CMP | Three circular platen guards, raised carrier carousel, brush clean tower |
| PVD | Hexagonal hub, radial target vessels, turbopumps |
| Metrology | C-frame optics, granite plinth, offset electronics |
| Probe | Large cantilever test head, probe card access, separate tester |

The runtime catalogue exposes three architectural features per tool and supports searching those features. Default exterior viewpoints are specified per tool so circular process arrangements and vertical equipment are viewed appropriately. The `axis3` asset URL revision refreshes older cached meshes and catalogue images.

## Rebuild

Tested with Blender 5.2.1 LTS on Windows, from the repository root:

```powershell
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python tools/build_icp_chamber.py
& 'C:\Program Files\Blender Foundation\Blender 5.2\blender.exe' --background --factory-startup --python tools/build_cmos_equipment.py
```

The second command builds all 18 tools, including etch, and accepts tool IDs after `--` to rebuild selected equipment, for example `-- scanner cmp`.

`tools/equipment_identity.py` defines 18 separate exterior architectures, tool-specific support mechanisms and export identity metadata. `tools/equipment_enclosures.py` provides shared doors, fasteners, vents and enclosure fabrication details. The two builders use the same exporter in `tools/build_icp_chamber.py`. Run from the repository root so material, scene and output paths are resolved consistently.

## Files and runtime

- `.blend`: editable source scene with materials, camera, lighting and preview mechanisms.
- `.glb`: exchange model, including preview mechanisms.
- `.json` + `.bin`: static browser geometry grouped by material, cutaway behavior and `equipmentRole`. The custom `waferflow-three-buffer-v1` envelope hydrates Three.js BufferGeometry arrays before ObjectLoader parsing. Revision `axis-3` stores `bufferByteLength` and `bufferSha256`; length and bounds are checked before parsing, and SHA-256 is verified where Web Crypto is available (HTTPS/localhost).
- `.jpg`: rendered exterior catalogue image; `-section.jpg`: internal mechanism study rendered with an independently fitted interior camera. Full PNG previews are local outputs in `.test-tools/blender/`.

The ICP model uses the `icp-chamber` stem; all others use `equipment-{tool}`. `fab-view.js` loads models on demand, keeps at most four parsed assets in its CPU cache, and disposes scene resources when switching equipment. Failed downloads or integrity checks retain the procedural equipment and expose **모델 다시 받기**. Only JSON, binary, GLB and JPEG files are in the public asset allowlist; Blender source and backups are not published.

Objects with `equipmentRole: exterior` hide in the internal view. Existing moving mechanisms are grouped independently and hide with the wafer and transfer robot in the exterior view, avoiding stray internal parts outside the enclosure. The WebGL render can be saved as PNG without modifying experiment data.

Validation: `tests/cmos_blender_browser.py` exercises every equipment family at four processing positions, checks cutaway behavior and preserved records, and forces download failures to verify fallback. `tests/cmos_atlas_browser.py` checks workspaces and calculated result workflows. `tests/cmos_axis_browser.py` checks all 18 exterior/internal groups and reference dialogs, PNG output, native modal keyboard navigation, real WebGL loss/restoration, corrupted binaries/retry, responsive views and the no-WebGL fallback.

## Process observation fix

Starting, resuming or stepping a process automatically opens the internal view. A second camera renders the actual wafer geometry and shared material texture from the process face; the main scene shows its physical pose. Transparent exported materials disable depth writes so baths and windows do not occlude later transparent surfaces. The whole-equipment camera fits visible geometry and the handling envelope; mobile displays the surface monitor below the equipment. `tests/cmos_wafer_visibility_browser.py` verifies 18 tools at six positions from the default exterior, including rendered PNG pixels and unchanged committed records.

## Identity regression

`tests/cmos_equipment_identity_browser.py` verifies all 18 `axis-3` assets, unique architecture metadata and binary checksums, actual mesh vertices within the live camera frame, normalised solid silhouettes, feature search and responsive 820/390/360 px views. It saves all exterior and internal live screenshots for manual review. Silhouette comparison catches nearly identical shapes; it does not establish physical accuracy or replace visual inspection. Existing wafer visibility and GPU lifecycle browser tests remain applicable.
