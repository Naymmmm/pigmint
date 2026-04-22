export type LegalPageSlug = "terms" | "privacy";

export type LegalSection = {
  heading: string;
  body: string[];
};

export type LegalPage = {
  slug: LegalPageSlug;
  title: string;
  summary: string;
  effectiveDate: string;
  sections: LegalSection[];
};

const effectiveDate = "2026-04-22";

export const legalPages: LegalPage[] = [
  {
    slug: "terms",
    title: "Terms of Service",
    summary:
      "These terms govern access to Pigmint, including generation tools, credits, subscriptions, uploads, and saved outputs.",
    effectiveDate,
    sections: [
      {
        heading: "Agreement",
        body: [
          "By accessing or using Pigmint, you agree to these Terms of Service. If you use Pigmint on behalf of an organization, you represent that you have authority to bind that organization to these terms.",
          "If you do not agree to these terms, do not use the service.",
        ],
      },
      {
        heading: "Accounts",
        body: [
          "You are responsible for activity under your account and for keeping your login credentials secure. You must provide accurate account information and promptly update it when it changes.",
          "You may not share an account in a way that bypasses access limits, credit limits, billing rules, moderation systems, or security controls.",
        ],
      },
      {
        heading: "Generation Services",
        body: [
          "Pigmint lets you submit prompts, reference images, and settings to create images, videos, and related generation outputs. Generation results may be imperfect, delayed, unavailable, or different from the prompt.",
          "Some generation features are provided by third-party model providers. Their availability, pricing, model behavior, and safety systems may change over time.",
        ],
      },
      {
        heading: "Your Content",
        body: [
          "You retain any rights you have in prompts, uploads, and outputs you submit or create through Pigmint. You grant Pigmint a limited license to host, process, transmit, display, and store that content as needed to operate, secure, and improve the service.",
          "You represent that you have the rights and permissions needed for any prompts, uploads, reference images, and other materials you provide.",
        ],
      },
      {
        heading: "Acceptable Use",
        body: [
          "You may not use Pigmint to create, request, upload, store, or distribute unlawful content, sexual content involving minors, non-consensual intimate imagery, targeted harassment, malware, fraud, or content that violates another person's rights.",
          "You may not attempt to bypass moderation, rate limits, billing controls, access controls, provider restrictions, or technical safeguards.",
        ],
      },
      {
        heading: "Credits, Plans, and Billing",
        body: [
          "Credits and free generations are usage entitlements for the service. They are not cash, stored value, or transferable currency.",
          "Paid plans, credit packs, subscription renewals, taxes, refunds, and cancellations are handled through the billing flow shown in the product. Unless required by law or stated in the checkout flow, completed purchases are non-refundable.",
        ],
      },
      {
        heading: "Intellectual Property",
        body: [
          "Pigmint, including its software, interface, branding, and documentation, is owned by Pigmint or its licensors. These terms do not grant you ownership of Pigmint's software or brand assets.",
          "You may not copy, modify, reverse engineer, scrape, or resell the service except as allowed by law or by written permission.",
        ],
      },
      {
        heading: "Service Changes",
        body: [
          "We may add, remove, suspend, or change models, features, pricing, credit rules, safety systems, and availability at any time.",
          "We may suspend or terminate access if we believe an account creates risk, violates these terms, violates provider requirements, or could harm the service or other users.",
        ],
      },
      {
        heading: "Disclaimers and Liability",
        body: [
          "Pigmint is provided as is and as available. We do not guarantee that outputs will be accurate, available, unique, non-infringing, or suitable for a particular use.",
          "To the maximum extent permitted by law, Pigmint will not be liable for indirect, incidental, special, consequential, exemplary, or punitive damages, or for lost profits, data, goodwill, or business opportunities.",
        ],
      },
      {
        heading: "Contact",
        body: [
          "Questions about these terms should be sent through the support or contact channel provided in the product or deployment where you access Pigmint.",
        ],
      },
    ],
  },
  {
    slug: "privacy",
    title: "Privacy Policy",
    summary:
      "This policy explains what Pigmint collects, how it is used, and how generation providers, authentication, billing, and storage fit into the product.",
    effectiveDate,
    sections: [
      {
        heading: "Information We Collect",
        body: [
          "We collect account information such as your email address and authentication identifiers, plus product data such as prompts, model choices, generation settings, folders, bookmarks, uploads, generated outputs, and usage history.",
          "We also collect technical data such as request metadata, device and browser information, IP-derived security signals, logs, error reports, and approximate timing or performance information.",
        ],
      },
      {
        heading: "Prompts, Uploads, and Outputs",
        body: [
          "Prompts, reference images, uploaded files, and generated outputs are processed so Pigmint can submit generation requests, display results, store your gallery, enforce safety rules, and troubleshoot the service.",
          "Do not submit sensitive personal information, confidential business information, or material you do not have permission to use.",
        ],
      },
      {
        heading: "How We Use Information",
        body: [
          "We use information to provide generation features, authenticate users, process billing, enforce credit limits, maintain safety systems, prevent abuse, improve reliability, respond to support requests, and comply with legal obligations.",
          "We may use aggregated or de-identified information to understand service performance and model usage.",
        ],
      },
      {
        heading: "Service Providers",
        body: [
          "Pigmint uses third-party providers for authentication, payments, infrastructure, storage, analytics or logging, and AI model inference. These providers process information only as needed to perform services for Pigmint or as described in their own terms.",
          "Generation requests may be sent to external model providers, including FAL and other providers supported by the product. Provider data handling can vary by model and endpoint.",
        ],
      },
      {
        heading: "Billing",
        body: [
          "Payment details are processed by Stripe or the billing provider shown at checkout. Pigmint stores billing status, plan, subscription, credit, and transaction metadata, but does not need to store full payment card numbers.",
        ],
      },
      {
        heading: "Cookies and Sessions",
        body: [
          "Pigmint uses cookies and similar storage for login sessions, security, preferences, and product operation. Disabling cookies may prevent sign-in or core features from working.",
        ],
      },
      {
        heading: "Sharing",
        body: [
          "We do not sell your personal information. We share information with service providers, when you direct us to share it, when needed to protect users or the service, or when required by law.",
          "If Pigmint is involved in a merger, acquisition, financing, reorganization, or sale of assets, information may be transferred as part of that transaction.",
        ],
      },
      {
        heading: "Retention and Deletion",
        body: [
          "We keep account, billing, prompt, upload, output, and usage information for as long as needed to provide the service, meet legal requirements, prevent abuse, resolve disputes, and maintain business records.",
          "You may delete individual generations in the product where supported. Some records may remain in backups, logs, billing systems, or security records for a limited period.",
        ],
      },
      {
        heading: "Security",
        body: [
          "We use reasonable technical and organizational safeguards designed to protect information. No internet service can guarantee absolute security.",
        ],
      },
      {
        heading: "Children",
        body: [
          "Pigmint is not directed to children under 13. You may not use the service if you are not old enough to consent to these terms under the laws that apply to you.",
        ],
      },
      {
        heading: "Changes and Contact",
        body: [
          "We may update this policy as the product, providers, or legal requirements change. The effective date shows when this version took effect.",
          "Privacy questions or deletion requests should be sent through the support or contact channel provided in the product or deployment where you access Pigmint.",
        ],
      },
    ],
  },
];

export function getLegalPage(slug: LegalPageSlug) {
  return legalPages.find((page) => page.slug === slug);
}
