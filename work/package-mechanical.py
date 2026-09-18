from pathlib import Path
from zipfile import ZipFile, ZIP_DEFLATED
root=Path('outputs/storyforge')
with ZipFile('outputs/叙境互动影游编辑器.zip','w',ZIP_DEFLATED) as z:
 for p in root.rglob('*'):
  if p.is_file():z.write(p, 'storyforge/'+p.relative_to(root).as_posix())
