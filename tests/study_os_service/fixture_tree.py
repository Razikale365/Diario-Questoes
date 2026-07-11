from pathlib import Path


AUDITED_FILES = (
    "Economia e Financas Publicas/PDF/Aula 01_Apostila.pdf",
    "Economia e Financas Publicas/PDF/Aula 01_Apostila_grifada.pdf",
    "Economia e Financas Publicas/PDF/Aula 01_Apostila_simplificada.pdf",
    "Economia e Financas Publicas/PDF/Aula 01_01_Slide.pdf",
    "Economia e Financas Publicas/PDF/Aula 1 - Resumo.pdf",
    "Economia e Financas Publicas/PDF/Aula 001 - Mapa Mental.pdf",
    "Direito Tributario/PDF/Aula_02_Apostila.pdf",
    "Trilha Estrategica/PDF/Aula 01_Trilha.pdf",
    "Dicas e Bizus/PDF/Aula 01_Bizu.pdf",
)


def create_audited_course_tree(root: Path) -> Path:
    root.mkdir()
    for relative_path in AUDITED_FILES:
        path = root / Path(relative_path)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(b"")
    return root
