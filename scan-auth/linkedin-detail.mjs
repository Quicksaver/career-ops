/** Browser-side reader shared by the pre-click snapshot and bounded JD wait. */
export function readLinkedInDetail({ card, jobId, previousJdText = '', expansionState } = {}) {
  const selectedId = new URL(location.href).searchParams.get('currentJobId') || '';
  const rendered = element => !!element && element.getClientRects().length > 0 &&
    !element.closest('[hidden], [inert]') &&
    getComputedStyle(element).visibility !== 'hidden';
  const visible = element => rendered(element) && !element.closest('[aria-hidden="true"]');
  const belongsToSelection = element => {
    const owner = element.closest('[data-job-id]');
    return !owner || owner.getAttribute('data-job-id') === selectedId;
  };
  const usable = element => visible(element) && belongsToSelection(element);
  const expandable = '[data-testid="expandable-text-box"]';
  const headings = 'h1, h2, h3, h4, h5, h6, [role="heading"]';
  const follows = (first, second) => !!(first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING);
  const level = heading => Number(heading.getAttribute('aria-level') || heading.tagName.slice(1)) || 2;
  const normalize = text => text.toLowerCase().replace(/[’‘]/g, "'").replace(/\s+/g, ' ').trim();
  const jobHeadings = new Set(['about the job', 'sobre a vaga', 'sobre o emprego', 'sobre este emprego', 'sobre esta vaga']);

  function locateDescription() {
    const regions = [...document.querySelectorAll(
      '#job-details, .jobs-description__content, .jobs-description, .description__text, ' +
      '[data-testid="job-description"], [data-test-job-description]'
    )].filter(usable);
    // Nested legacy containers describe one region, not competing postings.
    const roots = regions.filter(root => !regions.some(other => other !== root && root.contains(other)));
    if (roots.length > 1) return null;
    if (roots.length === 1) {
      const root = roots[0];
      const boxes = [...root.querySelectorAll(expandable)].filter(usable);
      if (boxes.length > 1) return null;
      return { element: boxes[0] || root, scope: root.closest('.jobs-description') || root };
    }

    // Modern LinkedIn can reuse the same expandable-text-box test ID for the
    // employer bio. Associate it with the job heading instead of DOM order.
    const candidates = [];
    for (const heading of [...document.querySelectorAll(headings)].filter(usable)) {
      if (!jobHeadings.has(normalize(heading.innerText))) continue;
      for (let scope = heading.parentElement; scope && !scope.matches('main, body, html'); scope = scope.parentElement) {
        const boundaries = [...scope.querySelectorAll(headings)].filter(usable);
        const boxes = [...scope.querySelectorAll(expandable)].filter(box => usable(box) && follows(heading, box) &&
          !boundaries.some(other => other !== heading && level(other) <= level(heading) && follows(heading, other) && follows(other, box)));
        if (!boxes.length) continue;
        if (boxes.length > 1) return null;
        candidates.push({ element: boxes[0], scope });
        break;
      }
    }
    const unique = candidates.filter((candidate, index) => candidates.findIndex(other => other.element === candidate.element) === index);
    return unique.length === 1 ? unique[0] : null;
  }

  const description = locateDescription();
  const text = description?.element.innerText?.trim() || '';
  if (card !== undefined) {
    if (card) card.click();
    return { clicked: !!card, previousJobId: selectedId, previousJdText: text };
  }
  if (selectedId !== jobId || !text || text === previousJdText || /^(?:…|\.{3}|loading[.\s…]*)$/i.test(text)) return false;

  const more = [...description.scope.querySelectorAll('button, [role="button"], [aria-expanded], span')].find(control => {
    // LinkedIn renders this expansion button with aria-hidden="true". That does
    // not make the button visually hidden. Restrict the exception to this button
    // inside the selected JD, never to an aria-hidden ancestor or employer bio.
    const expansionButton = control.closest('[data-testid="expandable-text-button"]');
    const renderedExpansion = expansionButton && description.scope.contains(expansionButton) &&
      rendered(control) && !expansionButton.parentElement?.closest('[aria-hidden="true"]') && belongsToSelection(control);
    const button = control.closest('button, [role="button"], [aria-expanded]');
    if ((!usable(control) && !renderedExpansion) || button?.getAttribute('aria-expanded') === 'true') return false;
    if (!description.element.contains(control)) {
      if (!follows(description.element, control)) return false;
      if ([...description.scope.querySelectorAll(headings)].some(heading => usable(heading) &&
        !description.element.contains(heading) && follows(description.element, heading) && follows(heading, control))) return false;
    }
    const link = control.closest('a[href]');
    if (link && !link.matches('[role="button"], [aria-expanded]')) return false;
    const label = normalize(control.innerText || '').replace(/^(?:…|\.{3})\s*/, '');
    return /^(?:(?:show|see) more|more|ver mais|mostrar mais|mais)$/.test(label);
  });
  if (more) {
    if (expansionState && !expansionState.clicked) {
      expansionState.clicked = true;
      const button = more.closest('button, [role="button"], [aria-expanded]');
      (button && description.scope.contains(button) ? button : more).click();
    }
    return false;
  }
  // A failed/missing expansion control must not turn a visible teaser into a JD.
  if (/(?:…|\.{3})\s*(?:(?:show|see) more|more|ver mais|mostrar mais|mais)\s*$/i.test(text)) return false;

  const apply = document.querySelector('a[aria-label="Apply on company website"]');
  return { applicationUrl: apply?.href?.trim() || `https://www.linkedin.com/jobs/view/${jobId}/`, jdText: text };
}
