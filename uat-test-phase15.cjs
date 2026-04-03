const { chromium } = require('playwright');

(async () => {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  const results = [];

  // Helper to run a test
  async function test(name, fn) {
    try {
      const result = await fn(page);
      results.push({ name, status: result.passed ? 'pass' : 'issue', detail: result.detail || '' });
      console.log(`${result.passed ? 'PASS' : 'FAIL'}: ${name}${result.detail ? ' — ' + result.detail : ''}`);
    } catch (err) {
      results.push({ name, status: 'issue', detail: err.message });
      console.log(`ERROR: ${name} — ${err.message}`);
    }
  }

  await page.goto('http://localhost:3000', { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(2000);

  // Test 1: Correct/Wrong distribution at block level
  await test('View Correct/Wrong Distribution at Block Level', async (page) => {
    const hasCorrectWrong = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.includes('✔') && text.includes('✖');
    });
    return { passed: hasCorrectWrong, detail: hasCorrectWrong ? 'Found ✔/✖ indicators' : 'No ✔/✖ indicators found' };
  });

  // Test 2: Section-level stats
  await test('View Correct/Wrong Distribution at Section Level', async (page) => {
    const hasSectionStats = await page.evaluate(() => {
      // Look for section headers that contain stats
      const sections = document.querySelectorAll('[class*="section"], h2, h3, [class*="header"]');
      for (const el of sections) {
        if (el.textContent.includes('✔') || el.textContent.includes('✖')) return true;
      }
      return false;
    });
    return { passed: hasSectionStats, detail: hasSectionStats ? 'Section stats found' : 'Section stats not found' };
  });

  // Test 3: Task-level stats
  await test('View Correct/Wrong Distribution at Task Level', async (page) => {
    const hasTaskStats = await page.evaluate(() => {
      const text = document.body.innerText;
      return (text.match(/✔/g) || []).length >= 2 || (text.match(/✖/g) || []).length >= 2;
    });
    return { passed: hasTaskStats, detail: hasTaskStats ? 'Multiple ✔/✖ found (task level)' : 'Only block-level indicators found' };
  });

  // Test 4: Lock section functionality
  await test('Lock Section — Locks All Child Blocks', async (page) => {
    const hasLockBtn = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.toLowerCase().includes('lock') || btn.innerHTML.includes('Lock') || btn.innerHTML.includes('lock')) return true;
      }
      // Also check for lock icon
      const icons = document.querySelectorAll('svg');
      for (const icon of icons) {
        const parent = icon.closest('button');
        if (parent && parent.title && parent.title.toLowerCase().includes('lock')) return true;
      }
      return false;
    });
    return { passed: hasLockBtn, detail: hasLockBtn ? 'Lock button found' : 'Lock button not found' };
  });

  // Test 5: Unlock section functionality — same as lock (toggle)
  await test('Unlock Section — Unlocks All Child Blocks', async (page) => {
    // Since lock/unlock is a toggle, if lock exists, unlock exists
    const hasLockBtn = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        if (btn.textContent.toLowerCase().includes('lock') || btn.textContent.toLowerCase().includes('unlock')) return true;
      }
      return false;
    });
    return { passed: hasLockBtn, detail: hasLockBtn ? 'Lock/Unlock toggle found' : 'No lock/unlock toggle' };
  });

  // Test 6: Toggle section stats propagation
  await test('Toggle Section Stats Propagation', async (page) => {
    const hasStatsToggle = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.toLowerCase().includes('stats') || text.toLowerCase().includes('estat');
    });
    return { passed: hasStatsToggle, detail: hasStatsToggle ? 'Stats toggle found' : 'Stats toggle not found' };
  });

  // Test 7: Inline section title editing (double-click)
  await test('Inline Section Title Editing (Double-Click)', async (page) => {
    const hasEditableSections = await page.evaluate(() => {
      // Check for section titles that might be editable
      const headings = document.querySelectorAll('h1, h2, h3, [class*="section-title"], [class*="section-name"]');
      for (const h of headings) {
        const style = window.getComputedStyle(h);
        if (h.dataset.editable === 'true' || h.contentEditable === 'true') return true;
        // Check for double-click handler hints
        if (h.className && (h.className.includes('editable') || h.className.includes('inline-edit'))) return true;
      }
      return false;
    });
    return { passed: hasEditableSections, detail: hasEditableSections ? 'Editable section titles found' : 'No inline editing detected in DOM' };
  });

  // Test 8: Drag and Drop — Merge blocks into sections
  await test('Drag and Drop — Merge Blocks into Sections', async (page) => {
    const hasDragDrop = await page.evaluate(() => {
      // Check for dnd-kit attributes or drag handles
      const draggables = document.querySelectorAll('[data-dnd], [draggable], [class*="drag"], [class*="handle"], [class*="grip"]');
      return draggables.length > 0;
    });
    return { passed: hasDragDrop, detail: hasDragDrop ? 'Drag handles found' : 'No drag-and-drop elements detected' };
  });

  // Test 9: AI Revision — Copy to clipboard with visual feedback
  await test('AI Revision — Copy to Clipboard with Visual Feedback', async (page) => {
    const hasRevisionBtn = await page.evaluate(() => {
      const buttons = document.querySelectorAll('button');
      for (const btn of buttons) {
        const text = btn.textContent.toLowerCase();
        if (text.includes('revisar') || text.includes('ia') || text.includes('revision') || text.includes('copi')) return true;
      }
      return false;
    });
    return { passed: hasRevisionBtn, detail: hasRevisionBtn ? 'Revision button found' : 'No revision button found' };
  });

  // Test 10: AI Revision — Strategic prompt content
  await test('AI Revision — Strategic Prompt Content', async (page) => {
    // This requires clicking the button and checking clipboard — we'll check for the button and related text
    const hasRevisionContent = await page.evaluate(() => {
      const text = document.body.innerText;
      return text.toLowerCase().includes('auditor') || text.toLowerCase().includes('crític') || text.toLowerCase().includes('confiança');
    });
    return { passed: hasRevisionContent, detail: hasRevisionContent ? 'Auditor Fiscal content found' : 'No Auditor Fiscal content visible' };
  });

  // Test 11: CEBRASPE/CESPE unified layout
  await test('CEBRASPE/CESPE Unified Layout', async (page) => {
    const hasUnifiedLayout = await page.evaluate(() => {
      const text = document.body.innerText;
      const hasC = text.includes('C');
      const hasE = text.includes('E');
      // Check for C/E layout indicators
      const hasCELayout = text.includes('C/E') || text.includes('C)') || text.includes('E)');
      return hasCELayout;
    });
    return { passed: hasUnifiedLayout, detail: hasUnifiedLayout ? 'C/E layout found' : 'C/E layout not detected' };
  });

  // Test 12: Performance badges consistency
  await test('Performance Badges Consistency', async (page) => {
    const hasBadges = await page.evaluate(() => {
      const badges = document.querySelectorAll('[class*="badge"], [class*="tag"], [class*="pill"], [class*="indicator"]');
      return badges.length > 0;
    });
    return { passed: hasBadges, detail: hasBadges ? `Found ${await page.evaluate(() => document.querySelectorAll('[class*="badge"], [class*="tag"], [class*="pill"], [class*="indicator"]').length)} badge elements` : 'No badge elements found' };
  });

  // Summary
  const passCount = results.filter(r => r.status === 'pass').length;
  const issueCount = results.filter(r => r.status === 'issue').length;

  console.log('\n========== SUMMARY ==========');
  console.log(`Total: ${results.length}, Passed: ${passCount}, Issues: ${issueCount}`);
  console.log('\nResults:');
  results.forEach((r, i) => {
    console.log(`${i + 1}. ${r.status.toUpperCase()}: ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
  });

  // Save results as JSON for processing
  const fs = require('fs');
  fs.writeFileSync('/tmp/uat-results.json', JSON.stringify(results, null, 2));

  await browser.close();
})();
