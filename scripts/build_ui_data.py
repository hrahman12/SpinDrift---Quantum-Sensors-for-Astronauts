"""Data the UI needs to show quantum physics and biology in equal measure, with real colours and real images.

data/device_map.json  For each device: the quantum physics (mechanism, physics curve, real lab data, simulators)
                      paired with the biology it reads (body signal, real recordings, NASA astronaut data).
data/palette.json     Colours calculated from cited wavelengths (CIE 1931 2° colour matching via the Wyman, Sloan &
                      Shirley 2013 analytic fit, then IEC 61966-2-1 sRGB). Infrared lines get no visible colour.
data/assets.json      Openly licensed real images (photos and figures of the real sensors), with licence and
+ data/assets/        attribution; resized for the web, nothing redrawn.
"""
import io

import sys
from pathlib import Path

import requests

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from server.common import DATA, log_status, meta, missing, vo, write_json  # noqa: E402
from server.realdata import CACHE, fetch  # noqa: E402

ASSETS = DATA / "assets"
UA = {"User-Agent": "SpinDrift-data-pipeline/10 (research prototype)"}
WYMAN = ("CIE 1931 2° standard observer colour-matching table (via colour-science 0.4.7, "
         "colour.MSDS_CMFS['CIE 1931 2 Degree Standard Observer']); sRGB per IEC 61966-2-1 (D65)")


# ---------------------------------------------------------------- colour from wavelength
def cmf(lam):
    import colour
    cmfs = colour.MSDS_CMFS["CIE 1931 2 Degree Standard Observer"]
    return tuple(float(v) for v in colour.wavelength_to_XYZ(lam, cmfs))


def srgb_hex(lam):
    x, y, z = cmf(lam)
    r = 3.2406 * x - 1.5372 * y - 0.4986 * z
    g = -0.9689 * x + 1.8758 * y + 0.0415 * z
    b = 0.0557 * x - 0.2040 * y + 1.0570 * z
    rgb = [max(0.0, c) for c in (r, g, b)]  # monochromatic light is outside sRGB: negative parts clipped
    m = max(rgb)
    if m <= 0:
        return None
    rgb = [c / m for c in rgb]  # hue at full display brightness

    def enc(c):
        return 12.92 * c if c <= 0.0031308 else 1.055 * c ** (1 / 2.4) - 0.055

    return "#" + "".join(f"{round(enc(c) * 255):02x}" for c in rgb)


def palette():
    # sanity check of the table against well-known CIE 1931 values
    checks = {555: (0.5121, 1.0000, 0.0057), 600: (1.0622, 0.6310, 0.0008), 450: (0.3362, 0.0380, 1.7721)}
    worst = max(abs(a - b) for lam, ref in checks.items() for a, b in zip(cmf(lam), ref))
    lines = [
        ("opm", "Rubidium D1 optical pumping line", 795, "Sulai et al., arXiv 1906.03227, Sec. III ('Rb D1 line at 795 "
         "nm'); the QZFM's own laser wavelength is not stated by QuSpin", "VERIFIED"),
        ("nv", "NV fluorescence band edge (695 nm long-pass filter)", 695, "Omar et al., arXiv 2601.18843, Section 4 "
         "(ZAQuant)", "VERIFIED"),
        ("cqd_patch", "Measured carbon-dot emission maximum (most common value)", 439, "Mendeley Data "
         "doi:10.17632/cmfbrvrb8y.1, external measurement records (general carbon dots, not the patch)", "VERIFIED"),
        ("cqd_patch", "Patch reader channel", 470, "doi:10.1021/acsnano.4c06191 (440/470/510 nm, to confirm)",
         "TO_CONFIRM"),
        ("space_heritage", "Swarm ASM helium laser", 1083, "ESA ASM overview (1083 nm laser)", "VERIFIED"),
    ]
    entries = []
    for dev, label, lam, src, st in lines:
        wl = vo(lam, "nm", src, "published_spec" if dev != "cqd_patch" or lam != 439 else "recorded", st)
        hx = srgb_hex(lam) if 380 <= lam <= 830 else None
        colour = (vo(hx, "sRGB hex", WYMAN, "calculated", "TO_CONFIRM" if st == "TO_CONFIRM" else "VERIFIED", None,
                     f"formula: CIE 1931 colour-matching table -> XYZ -> linear sRGB, negatives clipped, "
                     f"scaled to full brightness, sRGB gamma; inputs: {label} wavelength")
                  if hx else missing("sRGB hex", WYMAN, "calculated", "NOT_STATED",
                                     "infrared: outside the CIE visible range, no visible colour"))
        entries.append({"device": dev, "label": label, "wavelength": wl, "colour": colour})
    entries.append({"device": "qd_renin", "label": "Cy5 acceptor emission", "wavelength":
                    missing("nm", "doi:10.1021/ac302284s abstract does not give it", "published_spec", "NOT_STATED"),
                    "colour": missing("sRGB hex", WYMAN, "calculated", "NOT_STATED", "no cited wavelength yet")})
    obj = {"meta": meta(False, [WYMAN], note=f"table check at 450/555/600 nm: largest difference {worst:.4f}; beyond "
                                             "700 nm the CIE chromaticity stays at x 0.7347, y 0.2653 (deep red)"),
           "colours": entries}
    write_json(DATA / "palette.json", obj)
    return obj


# ---------------------------------------------------------------- real images
def _save_resized(raw: bytes, dest: Path, max_px=1600):
    from PIL import Image
    im = Image.open(io.BytesIO(raw))
    im.thumbnail((max_px, max_px))
    dest.parent.mkdir(parents=True, exist_ok=True)
    if dest.suffix.lower() in (".jpg", ".jpeg"):
        im.convert("RGB").save(dest, quality=85)
    else:
        im.save(dest)
    return im.size


def assets():
    out = []
    kiel = "https://physionet.org/files/kiel-cardio/1.0.0/images/"
    kiel_attr = ("Engelhardt, Frey & Schmidt, Kiel Cardio Database v1.0.0, PhysioNet, doi:10.13026/q6r2-zz68, "
                 "CC BY-SA 4.0")
    for name, title in (("kcd_sensors.jpg", "Four QuSpin QZFM Gen 1 OPMs in the Kiel sensor fixture"),
                        ("kcd_overview.jpg", "Kiel Cardio Database: OPM magnetocardiography set-up"),
                        ("kcd_markings.jpeg", "Sensor positions marked on the subject"),
                        ("coordinate_system.png", "Kiel coordinate system")):
        raw = fetch(kiel + name, CACHE / "kiel-cardio-1.0.0" / "images" / name).read_bytes()
        dest = ASSETS / "kiel" / name
        size = _save_resized(raw, dest)
        out.append({"id": f"kiel_{Path(name).stem}", "file": f"data/assets/kiel/{name}", "title": title, "device": "opm",
                    "kind": "photo" if name.endswith(("jpg", "jpeg")) else "figure", "source_url": kiel + name,
                    "licence": "CC BY-SA 4.0", "attribution": kiel_attr, "changes": f"resized to {size[0]}x{size[1]}",
                    "label": "Real QuSpin OPM sensors recording a human heart on Earth. Not an astronaut."})
    # NV paper figures (arXiv 2601.18843, CC BY 4.0): embedded raster images, saved as they are
    import pymupdf
    pdf = fetch("https://arxiv.org/pdf/2601.18843", CACHE / "arxiv-2601.18843" / "2601.18843.pdf")
    doc = pymupdf.open(pdf)
    nv_attr = ("Omar et al., 'Human Cardiac Measurements with Diamond Magnetometers', arXiv 2601.18843 (2026), "
               "CC BY 4.0")
    k = 0
    for pno in range(doc.page_count):
        for img in doc[pno].get_images(full=True):
            pix = pymupdf.Pixmap(doc, img[0])
            if pix.width < 300 or pix.height < 200:
                continue
            if pix.n - pix.alpha >= 4:
                pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
            k += 1
            dest = ASSETS / "nv_paper" / f"p{pno + 1}_img{k}.png"
            size = _save_resized(pix.tobytes("png"), dest)
            out.append({"id": f"nv_paper_p{pno + 1}_{k}", "file": f"data/assets/nv_paper/{dest.name}",
                        "title": f"Figure image from page {pno + 1} of arXiv 2601.18843", "device": "nv",
                        "kind": "figure", "source_url": "https://arxiv.org/abs/2601.18843", "licence": "CC BY 4.0",
                        "attribution": nv_attr, "changes": f"extracted from the PDF, resized to {size[0]}x{size[1]}",
                        "label": "Real NV-diamond sensors and their human MCG measurements (from the paper)."})
    # figshare supplement (CC BY 4.0): Fig. S1 TEM image of the CdTe/CdS quantum dots
    sup = CACHE / "figshare-c5468838" / "5362541_v1.pdf"
    if sup.exists():
        d2 = pymupdf.open(sup)
        for pno in range(d2.page_count):
            if "Fig. S1" not in d2[pno].get_text() and "Figure S1" not in d2[pno].get_text():
                continue
            for img in d2[pno].get_images(full=True):
                pix = pymupdf.Pixmap(d2, img[0])
                if pix.width < 200:
                    continue
                if pix.n - pix.alpha >= 4:
                    pix = pymupdf.Pixmap(pymupdf.csRGB, pix)
                dest = ASSETS / "qd" / f"figS1_tem_p{pno + 1}.png"
                size = _save_resized(pix.tobytes("png"), dest)
                out.append({"id": "qd_tem_figS1", "file": f"data/assets/qd/{dest.name}",
                            "title": "TEM image of the CdTe/CdS quantum dots (Fig. S1)", "device": "qd_renin",
                            "kind": "micrograph", "source_url": "https://doi.org/10.6084/m9.figshare.c.5468838.v1",
                            "licence": "CC BY 4.0", "attribution": "Li et al., Optics Express 29(17) 27171 (2021), "
                            "supplementary document, CC BY 4.0", "changes": f"extracted, resized to {size[0]}x{size[1]}",
                            "label": "Real quantum dots under the electron microscope (CdTe/CdS, not the renin sensor)."})
                break
    for f in sorted((DATA / "simulator_outputs").glob("*.png")):
        out.append({"id": f"sim_{f.stem}", "file": f"data/simulator_outputs/{f.name}", "title": f"ODMR-Lab output {f.stem}",
                    "device": "nv", "kind": "simulator_output",
                    "source_url": "https://huggingface.co/spaces/jeorgexyz/odmr-lab", "licence": "MIT (simulator)",
                    "attribution": "ODMR-Lab by jeorgexyz", "changes": "none",
                    "label": "Simulated spectrum from an online simulator (its legend says 'measured'; it is simulated)."})
    obj = {"meta": meta(False, ["PhysioNet Kiel Cardio Database", "arXiv 2601.18843", "figshare c.5468838",
                                "ODMR-Lab"], note="Only openly licensed images; each keeps its licence and attribution. "
                                                  "Product photos (e.g. QuSpin's) are not licensed for reuse and are "
                                                  "linked, not copied."),
           "assets": out}
    write_json(DATA / "assets.json", obj)
    return obj


# ---------------------------------------------------------------- physics <-> biology map
def device_map():
    m = {
        "opm": {
            "name": "Optically pumped magnetometer (QuSpin QZFM Gen-3)",
            "physics": {"quantum_effect": "specs.opm.quantum_effect", "curve": "physics.opm_zero_field",
                        "lab_data": None, "simulators": "simulators.opm",
                        "explain": "Laser light spin-polarises rubidium atoms; at zero field the vapour turns transparent, "
                                   "and a tiny field tips the spins and changes how much light gets through (a "
                                   "Lorentzian zero-field resonance)."},
            "biology": {"signals": ["heart: magnetocardiography R-peak and Q wave", "brain: somatosensory evoked field"],
                        "recorded": ["recorded/opm_heart_kiel", "recorded/opm_brain_mne"],
                        "comparison": "recorded/eeg_brain_ds004902 (conventional EEG, not a quantum sensor)",
                        "nasa": None},
            "main_card_rows": ["heart_q_wave", "brain_eeg"],
        },
        "nv": {
            "name": "NV-diamond magnetometer (JGU, ZAQuant, Q.ANT builds; arXiv 2601.18843)",
            "physics": {"quantum_effect": "spin-1 NV centre; microwaves at about 2.87 GHz flip ms = 0 to ±1, seen as a "
                                          "fluorescence dip (optically detected magnetic resonance)",
                        "curve": "physics.nv_odmr_lines", "lab_data": "recorded/nv_odmr_zenodo10629041",
                        "simulators": "simulators.nv (ODMR-Lab runs on every Run)",
                        "explain": "A field splits the two ODMR lines by 2γB (γ ≈ 28 MHz/mT); the builds carry a "
                                   "~1 mT bias and read heart fields of tens of pT after averaging."},
            "biology": {"signals": ["heart: averaged MCG, R-peak and Q-wave SNR per build"],
                        "recorded": ["nv_heart_derived (from recorded/opm_heart_kiel)"], "nasa": None},
            "main_card_rows": ["heart_q_wave"],
        },
        "qd_renin": {
            "name": "Quantum-dot renin nanosensor (Long et al., Anal. Chem. 2012)",
            "physics": {"quantum_effect": "specs.qd_renin.quantum_effect", "curve": "physics.qd_fret_vs_distance",
                        "lab_data": "recorded/qd_fret_figshare5468838", "simulators": "simulators.qd_renin",
                        "explain": "A quantum dot passes energy to Cy5 by FRET; renin cuts the peptide, Cy5 leaves, "
                                   "and the Cy5 count drops (single-molecule TIRF counting)."},
            "biology": {"signals": ["blood: renin activity (renin-angiotensin system)"], "recorded": [],
                        "nasa": "renin is not in open Inspiration4 data (nasa_i4.not_found)"},
            "main_card_rows": ["blood"],
        },
        "cqd_patch": {
            "name": "Carbon quantum-dot microneedle patch (Tabatabaee et al., ACS Nano 2024)",
            "physics": {"quantum_effect": "specs.cqd_patch.physics_label", "curve": "physics.cqd_quenching (not plotted: "
                        "constants not public)", "lab_data": "recorded/cqd_pl_mendeley_cmfbrvrb8y",
                        "simulators": "simulators.cqd_patch",
                        "explain": "Carbon-dot fluorescence is quenched and recovers selectively with bilirubin under "
                                   "blue light; carbon-dot emission is not a spin-based quantum measurement."},
            "biology": {"signals": ["skin: bilirubin in interstitial fluid"], "recorded": [],
                        "nasa": "nasa_i4 (Inspiration4 serum total bilirubin, OSD-575)"},
            "main_card_rows": ["skin_patch"],
        },
    }
    obj = {"meta": meta(False, ["data/specs.json", "data/physics.json", "data/recorded/*", "data/nasa_i4.json"],
                        note="Physics and biology are paired so the UI can give them equal space."), "devices": m}
    write_json(DATA / "device_map.json", obj)
    return obj


def main():
    device_map()
    p = palette()
    a = assets()
    log_status("data/palette.json", "done", "colours calculated from cited wavelengths (795, 695, 439, 470 nm; 1083 nm IR "
               "has none); " + p["meta"]["note"])
    log_status("data/assets.json", "done", f"{len(a['assets'])} openly licensed real images (Kiel CC BY-SA 4.0, arXiv "
               "2601.18843 CC BY 4.0, figshare CC BY 4.0, ODMR-Lab outputs)")
    log_status("data/device_map.json", "done", "physics <-> biology pairing per device for the UI")
    print("wrote device_map.json, palette.json, assets.json")
    for c in p["colours"]:
        print(" ", c["device"], c["label"], c["wavelength"]["value"], c["colour"]["value"])
    print(" ", p["meta"]["note"])


if __name__ == "__main__":
    main()
