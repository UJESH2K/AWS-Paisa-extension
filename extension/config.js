// Build-time settings, all public. Never put AWS credentials here.
//
//   apiUrl           the deployed Paisa API (no trailing slash). Empty means
//                    "no server": the panel offers a labelled sample instead.
//   region           where the user's CloudFormation quick-create opens.
//   roleTemplateUrl  public https URL of onboarding/role-template.yaml, used to
//                    build the one-click role link. Empty hides that step.
globalThis.PAISA_CONFIG = {
  apiUrl: "",
  region: "ap-south-1",
  roleTemplateUrl: "",
};
