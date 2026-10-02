/*
 * Utility functions for retrosynthesis
 */

function checkTemplatePrioritizers(templatePrioritizers) {
  // Using CAS model with others is ok if key is correct
  const context = JSON.parse(document.getElementById('django-context').textContent);
  if (context.casKeyOk) {
    return;
  }
  // Check that the input list of template prioritizers is valid
  const templateSets = new Set(templatePrioritizers.map((item) => item.template_set));
  if (templateSets.has('cas') && templateSets.size > 1) {
    throw new Error('The CAS template set cannot be combined with other template sets.');
  }
}

export { checkTemplatePrioritizers };
