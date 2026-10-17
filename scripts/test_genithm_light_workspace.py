"""Contracts for the real V40 interface; these do not execute scientific work."""
import re
import unittest
from pathlib import Path
ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / 'apps/web'
def source(path):
    return (WEB / path).read_text(encoding='utf-8')

class LightWorkspaceTests(unittest.TestCase):
    def test_single_root_theme_and_authentication(self):
        root = source('app/layout.tsx')
        layout = source('app/dashboard/layout.tsx')
        self.assertIn('data-genithm-theme="light"', root)
        self.assertIn('genithm-light.css', root)
        self.assertIn('GenithmBrand', root)
        self.assertIn('getClaims()', layout)
        self.assertIn('AnalysisLaunchGuard', layout)
        self.assertIn('GenithmWorkspaceFrame', layout)
        self.assertNotIn('<DashboardHomeOverview', layout)
        self.assertNotIn('<DashboardSectionNavigator', layout)
        self.assertIn('color-scheme:light', source('app/genithm-light.css'))

    def test_six_primary_destinations_and_disclosed_expert_tools(self):
        nav = source('components/dashboard-primary-nav.tsx')
        primary = nav.split('const primaryLinks = [', 1)[1].split('] as const', 1)[0]
        self.assertEqual(len(re.findall(r'href:', primary)), 6)
        for path in ['/dashboard/ai', '/dashboard/projects', '/dashboard/data', '/dashboard/pipelines', '/dashboard/results', '/dashboard/apps']:
            self.assertIn(path, primary)
        self.assertIn('<details', nav)
        self.assertIn('aria-current', nav)
        for path in ['/dashboard/fastq-qc', '/dashboard/variant-qc', '/dashboard/notebook', '/dashboard/operations']:
            self.assertIn(path, nav)

    def test_real_three_action_dock_and_three_chat_starters(self):
        dock = source('components/genithm-tool-dock.tsx')
        actions = dock.split('className="genithm-dock-actions"', 1)[1].split('</div>', 1)[0]
        self.assertEqual(actions.count('className="genithm-dock-action"'), 3)
        self.assertIn('scienceReady?', dock)
        self.assertIn('statusLabel(run.status)', dock)
        self.assertNotIn('Math.random', dock)
        home = source('app/dashboard/ai/page.tsx')
        self.assertIn('quickActions={[researchActions[5],researchActions[2],researchActions[3]]}', home)
        self.assertIn('scienceExecutionReady()', home)
        self.assertIn('createAiResearchProject', home)
        self.assertIn('genithm-logo.webp', home)
        self.assertIn('defaultProjectId={selectedProject?.id}', home)

    def test_new_pages_read_real_scoped_data(self):
        for path in ['app/dashboard/projects/page.tsx', 'app/dashboard/data/page.tsx', 'app/dashboard/apps/page.tsx']:
            page = source(path)
            self.assertIn('getClaims()', page)
            self.assertIn('redirect("/login")', page)
            self.assertNotIn('createServiceClient', page)
        data = source('app/dashboard/data/page.tsx')
        self.assertIn('.eq("created_by",owner)', data)
        self.assertIn('.in("project_id",ids)', data)
        self.assertIn('SequenceUploadPanel', data)
        self.assertIn('role="alert"', data)

    def test_every_major_research_surface_uses_light_tokens(self):
        paths = ['app/dashboard/ai/chat.module.css', 'app/dashboard/ai/[id]/conversation.module.css',
                 'components/ai-chat-composer.module.css', 'components/research-chat-sidebar.module.css',
                 'app/dashboard/results/results.module.css', 'app/dashboard/results/compare/compare.module.css',
                 'app/dashboard/results/studies/studies.module.css', 'app/dashboard/notebook/notebook.module.css',
                 'app/dashboard/pipelines/pipeline.module.css', 'app/dashboard/fastq-qc/fastq-qc.module.css',
                 'app/dashboard/variant-qc/variant-qc.module.css',
                 'app/dashboard/scientific-jobs/[id]/scientific-job.module.css',
                 'app/dashboard/scientific-jobs/[id]/scientific-explorer.module.css']
        for path in paths:
            css = source(path)
            with self.subTest(path=path):
                self.assertIn('var(--g-', css)
                self.assertNotRegex(css, r'background\s*:\s*#(?:111e25|132732|122632|112632|0d1f2a|10212d)')
                self.assertIn('@media', css)

    def test_supplied_artwork_and_accessible_search(self):
        self.assertIn('/genithm-logo.webp', source('components/genithm-brand.tsx'))
        self.assertTrue((WEB / 'public/genithm-logo.webp').is_file())
        frame = source('components/genithm-workspace-frame.tsx')
        for token in ['showModal()', 'keydown', 'aria-labelledby', 'aria-expanded', 'Skip to workspace', 'not the contents of private research files']:
            self.assertIn(token, frame)
        self.assertNotIn('Dr. Jane Doe', frame)
        css = source('app/genithm-light.css')
        self.assertIn(':focus-visible', css)
        self.assertIn('prefers-reduced-motion', css)
        self.assertNotIn('filter:invert', css)

if __name__ == '__main__':
    unittest.main()
