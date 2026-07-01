(function () {
  const textBindings = [
    [".docs-card-group.docs-cols-3:nth-of-type(1) .docs-card:nth-child(1) p", "docs.whatCopy"],
    [".docs-card-group.docs-cols-3:nth-of-type(1) .docs-card:nth-child(2) p", "docs.whyCopy"],
    [".docs-card-group.docs-cols-3:nth-of-type(1) .docs-card:nth-child(3) p", "docs.howCopy"],
    [".docs-section:nth-of-type(3) .docs-section-header p", "docs.dataIntro"],
    [".docs-section:nth-of-type(3) .docs-card:nth-child(1) p", "docs.ecosystemsCopy"],
    [".docs-section:nth-of-type(3) .docs-card:nth-child(2) p", "docs.collectionCopy"],
    [".docs-section:nth-of-type(3) .docs-card:nth-child(3) p", "docs.freshnessCopy"],
    [".docs-section:nth-of-type(4) .docs-section-header p", "docs.metricsIntro"],
    [".docs-section:nth-of-type(4) .docs-card:nth-child(1) p", "docs.measureCopy"],
    [".docs-section:nth-of-type(4) .docs-card:nth-child(2) p", "docs.limitationsCopy"],
    [".docs-section:nth-of-type(4) .docs-card:nth-child(3) p", "docs.attributionCopy"],
    [".docs-faq-item:nth-child(1) dt", "docs.faqFreshnessQuestion"],
    [".docs-faq-item:nth-child(1) dd", "docs.faqFreshnessAnswer"],
    [".docs-faq-item:nth-child(2) dt", "docs.faqEcosystemQuestion"],
    [".docs-faq-item:nth-child(2) dd", "docs.faqEcosystemAnswer"],
    [".docs-faq-item:nth-child(3) dt", "docs.faqMergedQuestion"],
    [".docs-faq-item:nth-child(3) dd", "docs.faqMergedAnswer"],
    [".docs-faq-item:nth-child(4) dt", "docs.faqBotsQuestion"],
    [".docs-faq-item:nth-child(4) dd", "docs.faqBotsAnswer"],
    [".docs-faq-item:nth-child(5) dt", "docs.faqTierQuestion"],
    [".docs-faq-item:nth-child(5) dd", "docs.faqTierAnswer"],
    [".docs-section:nth-of-type(6) .docs-section-header p", "docs.technicalIntro"],
    [".docs-section:nth-of-type(6) .docs-card:nth-child(1) p", "docs.techCopy"],
    [".docs-section:nth-of-type(7) .docs-section-header p", "docs.contributingIntro"],
    [".docs-section:nth-of-type(7) .docs-card:nth-child(2) h2", "docs.trackedTitle"],
    [".docs-section:nth-of-type(7) .docs-card:nth-child(2) p", "docs.trackedCopy"],
  ];

  const htmlBindings = [
    [".docs-section:nth-of-type(6) .docs-card:nth-child(2) p", "docs.devCopy"],
    [".docs-section:nth-of-type(6) .docs-card:nth-child(3) p", "docs.repoCopy"],
    [".docs-section:nth-of-type(7) .docs-card:nth-child(1) p", "docs.contributingCopy"],
  ];

  function applyDocsTranslations() {
    if (!window.pocI18n) return;
    textBindings.forEach(([selector, key]) => {
      const el = document.querySelector(selector);
      if (el) el.textContent = window.pocI18n.t(key);
    });
    htmlBindings.forEach(([selector, key]) => {
      const el = document.querySelector(selector);
      if (el) el.innerHTML = window.pocI18n.t(key);
    });
  }

  if (window.pocI18n?.ready) {
    window.pocI18n.ready.then(applyDocsTranslations);
  } else {
    window.addEventListener("poc:locale-ready", applyDocsTranslations, { once: true });
  }
})();
