"""Ownership guards must reject before touching unrelated filesystem state."""
import io
from pathlib import Path
import tarfile
import tempfile
import time
import unittest

from rehearse_release_layout import Layout, project_files


class LayoutGuards(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        (self.root / 'web').mkdir()
        (self.root / 'web/index.html').write_bytes(b'prior')
        (self.root / 'candidate').mkdir()
        (self.root / 'candidate/index.html').write_bytes(b'candidate')
        self.layout = Layout(self.root, b'owned-override')

    def test_existing_backup_rejected_before_mutation(self):
        self.layout.saved.mkdir()
        (self.layout.saved / 'sentinel').write_bytes(b'unrelated')
        with self.assertRaisesRegex(ValueError, '^previous-web-already-exists$'):
            self.layout.activate()
        self.assertEqual(self.layout.actions, [])
        self.assertEqual((self.layout.web / 'index.html').read_bytes(), b'prior')
        self.assertEqual((self.layout.saved / 'sentinel').read_bytes(), b'unrelated')

    def test_dangling_override_rejected_before_mutation(self):
        self.layout.override.symlink_to(self.root / 'missing')
        with self.assertRaisesRegex(ValueError, '^override-already-exists$'):
            self.layout.activate()
        self.assertEqual(self.layout.actions, [])
        self.assertFalse(self.layout.saved.exists())

    def test_changed_override_retained(self):
        self.layout.activate()
        self.layout.override.write_bytes(b'other-release')
        with self.assertRaisesRegex(ValueError, '^override-ownership-mismatch$'):
            self.layout.rollback()
        self.assertEqual(self.layout.override.read_bytes(), b'other-release')
        self.assertTrue(self.layout.web.is_symlink())
        self.assertEqual((self.layout.saved / 'index.html').read_bytes(), b'prior')

    def test_changed_web_target_retained(self):
        self.layout.activate()
        self.layout.web.unlink()
        self.layout.web.symlink_to(self.root / 'other-release')
        with self.assertRaisesRegex(ValueError, '^web-ownership-mismatch$'):
            self.layout.rollback()
        self.assertEqual(self.layout.web.readlink(), self.root / 'other-release')
        self.assertEqual(self.layout.override.read_bytes(), b'owned-override')
        self.assertTrue(self.layout.saved.is_dir())

    def test_switch_restores_original_inode_and_bytes(self):
        original_inode = self.layout.web.stat().st_ino
        self.layout.activate()
        self.assertEqual((self.layout.web / 'index.html').read_bytes(), b'candidate')
        self.layout.rollback()
        self.assertEqual(self.layout.web.stat().st_ino, original_inode)
        self.assertEqual((self.layout.web / 'index.html').read_bytes(), b'prior')
        self.assertFalse(self.layout.override.exists())

    def test_unsafe_archive_projection_rejected(self):
        for index, (name, kind) in enumerate([('web/../outside', tarfile.REGTYPE),
                                            ('web/link', tarfile.SYMTYPE)]):
            with self.subTest(name=name):
                archive = self.root / f'{index}.tar'
                with tarfile.open(archive, 'w') as tar:
                    member = tarfile.TarInfo(name)
                    member.type = kind
                    if kind == tarfile.SYMTYPE:
                        member.linkname = '../outside'
                        tar.addfile(member)
                    else:
                        member.size = 1
                        tar.addfile(member, io.BytesIO(b'x'))
                with self.assertRaisesRegex(ValueError, 'unsafe-web-member|unsupported-web-member-type'):
                    project_files(archive, 'web', self.root / f'projection-{index}', time.time() + 10)
                self.assertFalse((self.root / 'outside').exists())

    def test_projection_deadline_enforced(self):
        archive = self.root / 'deadline.tar'
        with tarfile.open(archive, 'w') as tar:
            member = tarfile.TarInfo('web/index.html')
            member.size = 1
            tar.addfile(member, io.BytesIO(b'x'))
        with self.assertRaises(Exception) as failure:
            project_files(archive, 'web', self.root / 'projection', time.time() - 1)
        self.assertIn('deadline', str(failure.exception))
        self.assertFalse((self.root / 'projection/index.html').exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
