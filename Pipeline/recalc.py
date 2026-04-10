"""
recalc.py — Headless LibreOffice recalc wrapper
------------------------------------------------
Used by the Rerun engine to force-recalculate every formula in a workbook
that's been modified by openpyxl. openpyxl writes formulas but does NOT
evaluate them — it just stores the cached value from when the file was last
opened in Excel/LibreOffice. We need real values for read-back, so we run
LibreOffice in headless mode to recalc and re-save the file.

LibreOffice must be installed on the host. The Render service uses a Docker
image with `libreoffice-calc` apt package; locally, install via your OS
package manager.

Usage:
    from recalc import recalc_workbook
    recalc_workbook(Path("/tmp/Ping_SRCH-XXX_Model.xlsx"))
    # The file at the same path now contains recalculated values.
"""

import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

# Allow override for local dev — on Render Docker image this is just "soffice"
SOFFICE = os.environ.get("SOFFICE_BIN", "soffice")

# Generous timeout — the Multifamily template recalcs in ~3s cold and ~1.2s warm
RECALC_TIMEOUT_SECONDS = 90


class RecalcError(RuntimeError):
    pass


def recalc_workbook(xlsx_path: Path) -> Path:
    """
    Force-recalc a .xlsx file in place using headless LibreOffice.

    Strategy:
      1. Copy the file into a temp dir (LibreOffice writes the converted file
         next to the input and we don't want stray files in the working dir).
      2. Run `soffice --headless --calc --convert-to xlsx --outdir TMP IN`.
      3. LibreOffice produces a file with the same name in TMP. That file's
         formulas have been recalculated and the cached values updated.
      4. Move the recalced file back over the original path.
      5. Return the original path.

    Raises RecalcError on any failure (binary missing, conversion failed,
    output file not produced).
    """
    xlsx_path = Path(xlsx_path)
    if not xlsx_path.exists():
        raise RecalcError(f"Input workbook does not exist: {xlsx_path}")

    if shutil.which(SOFFICE) is None:
        raise RecalcError(
            f"LibreOffice binary '{SOFFICE}' not found on PATH. "
            "On Render this comes from the Docker image. "
            "Locally, install libreoffice-calc."
        )

    with tempfile.TemporaryDirectory(prefix="recalc-") as tmp:
        tmp_dir = Path(tmp)
        in_dir  = tmp_dir / "in"
        out_dir = tmp_dir / "out"
        in_dir.mkdir()
        out_dir.mkdir()

        # Copy input into the input subdir (so output dir is empty and there's
        # no name collision when LibreOffice writes the converted file)
        in_copy = in_dir / xlsx_path.name
        shutil.copy2(xlsx_path, in_copy)

        # Use a per-call user profile so two parallel recalcs can't collide
        profile_dir = tmp_dir / "lo-profile"
        profile_dir.mkdir(exist_ok=True)
        user_profile = f"-env:UserInstallation=file://{profile_dir}"

        cmd = [
            SOFFICE,
            user_profile,
            "--headless",
            "--calc",
            "--convert-to", "xlsx",
            "--outdir", str(out_dir),
            str(in_copy),
        ]

        try:
            result = subprocess.run(
                cmd,
                capture_output=True,
                text=True,
                timeout=RECALC_TIMEOUT_SECONDS,
                check=False,
            )
        except subprocess.TimeoutExpired as e:
            raise RecalcError(
                f"LibreOffice recalc timed out after {RECALC_TIMEOUT_SECONDS}s: {e}"
            ) from e

        if result.returncode != 0:
            raise RecalcError(
                f"LibreOffice exited {result.returncode}\n"
                f"stdout: {result.stdout}\nstderr: {result.stderr}"
            )

        # The converted file lands in out_dir with the same basename
        out_file = out_dir / xlsx_path.name
        if not out_file.exists():
            # Some LibreOffice versions sanitize the filename — pick any .xlsx
            xlsxs = [p for p in out_dir.iterdir() if p.suffix.lower() == ".xlsx"]
            if not xlsxs:
                raise RecalcError(
                    f"LibreOffice did not produce an output file. "
                    f"out_dir contents: {[p.name for p in out_dir.iterdir()]}"
                )
            out_file = xlsxs[0]

        # Overwrite the original
        shutil.move(str(out_file), str(xlsx_path))

    return xlsx_path


if __name__ == "__main__":
    # CLI usage:  python3 recalc.py path/to/file.xlsx
    if len(sys.argv) != 2:
        print("Usage: python3 recalc.py <path-to-xlsx>", file=sys.stderr)
        sys.exit(2)
    target = Path(sys.argv[1])
    try:
        recalc_workbook(target)
        print(f"Recalculated: {target}")
    except RecalcError as e:
        print(f"ERROR: {e}", file=sys.stderr)
        sys.exit(1)
