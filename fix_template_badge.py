"""
fix_template_badge.py — Bug 5
Reposiciona o shape {{LABEL}} no template PPTX para Y=190000 EMU,
evitando colisão com a barra navy do slide MODULE_COVER.

Uso:
  python fix_template_badge.py edugenai_template.pptx

Requer: lxml  (pip install lxml)
Faz um backup automático antes de modificar.
"""

import sys
import shutil
import zipfile
import re
from pathlib import Path
from lxml import etree

# ── Namespaces OOXML ───────────────────────────────────────────────────────────
NS = {
    "a":   "http://schemas.openxmlformats.org/drawingml/2006/main",
    "p":   "http://schemas.openxmlformats.org/presentationml/2006/main",
    "r":   "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
}

# Slide de MODULE_COVER no template é o slide3.xml (índice 2 do LAYOUT_INDEX)
MODULE_COVER_SLIDE = "ppt/slides/slide3.xml"

# Y alvo em EMU — acima da barra navy, próximo ao topo do slide
TARGET_Y_EMU = 190000


def find_label_shape(tree: etree._Element) -> etree._Element | None:
    """
    Localiza o shape cujo texto contém {{LABEL}}.
    Percorre todos os <p:sp> e verifica o texto de todos os <a:t>.
    """
    spTree = tree.find(".//p:cSld/p:spTree", NS)
    if spTree is None:
        # fallback sem namespace
        spTree = tree.find(".//{http://schemas.openxmlformats.org/presentationml/2006/main}spTree")
    if spTree is None:
        return None

    for sp in spTree.findall(
        "{http://schemas.openxmlformats.org/presentationml/2006/main}sp"
    ):
        texts = sp.findall(
            ".//{http://schemas.openxmlformats.org/drawingml/2006/main}t"
        )
        combined = "".join((t.text or "") for t in texts)
        if "{{LABEL}}" in combined:
            return sp
    return None


def reposition_label(pptx_path: str) -> None:
    path = Path(pptx_path)
    if not path.exists():
        print(f"Arquivo não encontrado: {pptx_path}")
        sys.exit(1)

    # Backup
    backup = path.with_suffix(".bak.pptx")
    shutil.copy2(path, backup)
    print(f"Backup criado: {backup}")

    # Lê o zip
    with zipfile.ZipFile(path, "r") as z:
        names = z.namelist()
        if MODULE_COVER_SLIDE not in names:
            print(f"Slide não encontrado no template: {MODULE_COVER_SLIDE}")
            print(f"Slides disponíveis: {[n for n in names if n.startswith('ppt/slides/slide')]}")
            sys.exit(1)
        slide_xml = z.read(MODULE_COVER_SLIDE)
        other_files = {n: z.read(n) for n in names if n != MODULE_COVER_SLIDE}

    # Parse
    tree = etree.fromstring(slide_xml)

    label_sp = find_label_shape(tree)
    if label_sp is None:
        print("Shape {{LABEL}} não encontrado no slide MODULE_COVER.")
        print("Verifique se o template correto foi fornecido.")
        sys.exit(1)

    # Localiza <a:off> dentro de <p:spPr><a:xfrm>
    off_el = label_sp.find(
        ".//{http://schemas.openxmlformats.org/drawingml/2006/main}off"
    )
    if off_el is None:
        print("Elemento <a:off> não encontrado no shape {{LABEL}}.")
        sys.exit(1)

    old_y = off_el.get("y", "?")
    off_el.set("y", str(TARGET_Y_EMU))
    print(f"{{LABEL}} reposicionado: y={old_y} → y={TARGET_Y_EMU} EMU")

    # Serializa de volta
    new_slide_xml = etree.tostring(tree, xml_declaration=True, encoding="UTF-8", standalone=True)

    # Reescreve o zip
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr(MODULE_COVER_SLIDE, new_slide_xml)
        for name, data in other_files.items():
            z.writestr(name, data)

    print(f"Template salvo: {path}")
    print()
    print("── Re-upload para o Supabase Storage ────────────────────────────────")
    print("Execute o comando abaixo (substitua PROJECT_REF pelo ref do projeto):")
    print()
    stem = path.stem
    print(f"  npx supabase storage cp {path} ss:///templates/edugenai_template.pptx \\")
    print(f"    --project-ref $PROJECT_REF")
    print()
    print("Ou via curl:")
    print(f"  curl -X POST 'https://$PROJECT_REF.supabase.co/storage/v1/object/templates/edugenai_template.pptx' \\")
    print(f"    -H 'Authorization: Bearer $SERVICE_ROLE_KEY' \\")
    print(f"    -H 'Content-Type: application/vnd.openxmlformats-officedocument.presentationml.presentation' \\")
    print(f"    --data-binary @{path}")


if __name__ == "__main__":
    if len(sys.argv) < 2:
        print(f"Uso: python {sys.argv[0]} <caminho_para_template.pptx>")
        sys.exit(1)
    reposition_label(sys.argv[1])
