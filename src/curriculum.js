export const DOMAINS = {
  content:       { color: '#1B5E8A', lt: '#E5EFF6', label: 'Purpose Science Content' },
  translational: { color: '#2D6B4E', lt: '#E5F0EA', label: 'Translational & Community' },
  grant:         { color: '#6B2738', lt: '#F2E8EB', label: 'Grant Development' },
  teaching:      { color: '#4A3570', lt: '#EDE9F5', label: 'Course Design & Teaching' },
  all:           { color: '#2B4040', lt: '#E5EEED', label: 'All Four Domains' },
};

export const SESSIONS = [
  {
    id: 'jul', month: 'July', domain: 'content', inPerson: false,
    title: 'Foundations of Purpose Science',
    inquiry: "What do we mean when we say 'purpose,' and what is at stake in how we define it?",
    before: "Read one foundational purpose science text and write a paragraph: how does this definition fit (or not fit) what you have observed in your own work?",
    after: "Post a 200-word reflection to the cohort forum: how has the session sharpened, complicated, or changed your working definition of purpose? What question is more pressing for you now than before?",
    description: "The fellowship year opens with a dive into the scientific foundations of purpose. Fellows establish a shared conceptual vocabulary, survey the landmark empirical literature, and situate purpose science within the broader landscape of positive youth development and developmental psychology. This session ensures that fellows, regardless of their prior proximity to purpose science, enter the year with a rigorous and common intellectual foundation.",
    goals: [
      "Articulate a clear, research-grounded definition of purpose and distinguish it from related constructs (meaning, identity, motivation, goal pursuit)",
      "Survey the landmark empirical literature on purpose, including key longitudinal and intervention studies",
      "Identify open questions and contested debates that represent opportunities for new scholarship",
      "Begin developing a personal intellectual map of where your research interests intersect with the purpose science field",
    ],
    activities: [
      { text: "Guided reading and annotation of 4–6 foundational purpose science texts, with structured reflection prompts", time: "10 min" },
      { text: "Small group discussion: Where does your prior scholarship connect to purpose science? Where does it diverge?", time: "15 min" },
      { text: "'Purpose Science Landscape' mapping exercise: fellows collaboratively chart the field's major themes, methods, populations studied, and gaps", time: "15 min" },
      { text: "Guest presentation by a senior Lab of Labs researcher on the state of the field and its most pressing unanswered questions", time: "20 min" },
      { text: "Personal Purpose Positioning — Write a 150-word statement on your own relationship to purpose as a scholar or practitioner, then pair-share. Surfaces prior assumptions before literature engagement.", time: "15 min", isNew: true },
      { text: "Contested Definitions Fishbowl — Fellows are assigned different definitional frameworks (Damon; McKnight & Kashdan; Bronk) and defend them in a rotating fishbowl. Surfaces the stakes embedded in how we define the construct.", time: "15 min", isNew: true },
    ],
    readings: [
      "Damon, W., Menon, J., & Bronk, K. C. (2003). The development of purpose during adolescence",
      "Burrow, A. L., & Hill, P. L. (2011). Purpose as a form of identity capital for positive youth adjustment",
      "McKnight, P. E., & Kashdan, T. B. (2009). Purpose in life as a system that creates and sustains health and well-being",
    ],
    reflectPrompts: [
      "Which definition of purpose felt most aligned with what you observe in your own work — and why?",
      "What assumptions about who has purpose (and who doesn't) did you notice in the texts?",
      "What is one thing you believe about purpose that the literature hasn't yet confirmed?",
    ],
    connectsTo: "As you build a shared vocabulary for purpose, begin noticing: whose definitions have shaped the literature — and whose haven't? That question anchors August.",
  },

  {
    id: 'aug', month: 'August', domain: 'content', inPerson: false,
    title: 'Purpose Across Contexts: Culture, Identity, and Equity',
    inquiry: "Whose purpose is represented in the literature — and whose is not?",
    before: "Select a purpose science study and examine its sample: who participated, who was excluded, and what assumptions about purpose are embedded in its measures? Bring a one-page analysis.",
    after: "Identify one gap in the purpose literature that your home institution or community context is uniquely positioned to address. Write a brief research provocation (150–200 words) and share it with the cohort.",
    description: "Purpose science has historically concentrated on certain populations and institutional contexts. This session expands the frame, exploring how purpose is shaped by cultural context, racial and ethnic identity, socioeconomic circumstance, and structural inequality. Fellows examine both what the existing literature tells us about purpose across diverse populations and where critical gaps remain — gaps their own research programs may be uniquely positioned to address.",
    goals: [
      "Analyze how cultural context shapes the development, expression, and measurement of purpose",
      "Critically evaluate the existing literature on purpose across diverse racial, ethnic, and socioeconomic groups",
      "Identify ways in which standard purpose measures may carry cultural assumptions that limit generalizability",
      "Connect equity considerations to your own emerging research questions and community partnerships",
    ],
    activities: [
      { text: "Critical reading exercise: Fellows review 2–3 purpose studies and analyze sample characteristics, measurement tools, and generalizability claims", time: "15 min" },
      { text: "Panel discussion with Community Research Mentors on how purpose shows up — and is talked about — in the communities they serve", time: "20 min" },
      { text: "Reflective writing: How might your home institution's community context shape the purpose questions worth asking?", time: "10 min" },
      { text: "Introduction to culturally responsive research design principles", time: "15 min" },
      { text: "'Whose Study Is This?' Protocol — Fellows apply a structured four-lens critique (sample, measures, context, assumptions) to three studies, building a shared analytical template for the year.", time: "15 min", isNew: true },
      { text: "Community-Centered Research Question Charrette — Small groups draft what a study designed by and for their community partner's constituents might look like, then compare across groups.", time: "15 min", isNew: true },
    ],
    readings: [
      "Sumner, R., Burrow, A. L., & Hill, P. L. (2018). The development of purpose in life among adolescents who experience marginalization",
      "Selected readings on culturally responsive research methods in developmental science",
      "Purpose Commons National Purpose Survey co-design documentation (internal)",
    ],
    reflectPrompts: [
      "What assumptions about 'universal' purpose did you find embedded in the studies you examined?",
      "Whose voice or experience is most conspicuously absent from the literature — and why does that matter for your research?",
      "What would it mean to let community context reshape your research question, not just your sample?",
    ],
    connectsTo: "Clarity about equity gaps in the literature becomes the foundation for asking: what does research partnership look like when designed around those gaps? That is September's opening question.",
  },

  {
    id: 'sep', month: 'September', domain: 'translational', inPerson: false,
    title: 'Translational Research Methods and Community-Based Design',
    inquiry: "What does it mean to study purpose with communities rather than on them?",
    before: "Listen to or read one practitioner account of a research partnership gone well — and one that didn't. Come prepared to discuss: what made the difference, and what does that mean for how you want to work?",
    after: "Draft your researcher-practitioner partnership philosophy: a one-page statement of how you intend to show up in community partnerships, what you will offer, and what you will genuinely be willing to learn. Share with your assigned mentor.",
    description: "This session provides fellows with a rigorous introduction to translational research methods — the scientific and relational practices that allow academic knowledge to move into and be shaped by real-world contexts. Fellows learn frameworks for community-based participatory research, examine the continuum from basic to applied science, and begin developing their own researcher-practitioner partnership philosophy.",
    goals: [
      "Distinguish between basic, applied, and translational research and articulate the value and demands of each",
      "Understand core principles of CBPR and how they apply to purpose science",
      "Identify the relational competencies — trust-building, communication across difference, navigating power — required for effective community partnerships",
      "Begin drafting a personal researcher-practitioner partnership philosophy statement",
    ],
    activities: [
      { text: "Purpose Commons-led workshop: Introduction to the translational research continuum and community-engaged research frameworks", time: "20 min" },
      { text: "Case study analysis: Two real-world examples of community-engaged research in youth development — one successful, one that encountered significant challenges", time: "15 min" },
      { text: "Dyadic reflection with assigned Lab of Labs mentor: What does your current scholarship look like on the translational continuum, and where do you want it to go?", time: "15 min" },
      { text: "Introduction to the co-design process used by Purpose Commons Design Teams", time: "15 min" },
      { text: "Partnership Values Inventory — Fellows complete a self-assessment ranking their priorities in partnership work (speed vs. depth, control vs. co-ownership) and discuss how those priorities align — or create tension — with community norms.", time: "10 min", isNew: true },
      { text: "Power Mapping Exercise — Using a structured diagram, fellows map themselves in a hypothetical community-university partnership, identifying where authority concentrates and how to distribute it intentionally.", time: "15 min", isNew: true },
    ],
    readings: [
      "Israel, B. A., et al. (1998). Review of community-based research: Assessing partnership approaches to improve public health",
      "Purpose Commons Translational Research Framework documentation (internal)",
      "Selected readings on research-practice partnerships in education and youth development",
    ],
    reflectPrompts: [
      "Where do you sit on the translational continuum right now — and where do you want to be by the end of the fellowship year?",
      "What values or habits from your academic training might create friction in community partnership? How will you manage that?",
      "What would you need to genuinely learn from a community partner, not just learn about?",
    ],
    connectsTo: "Knowing how to partner with communities is half the work. The other half is knowing how to communicate what you learn there — in language different audiences can act on. That is October's focus.",
  },

  {
    id: 'oct', month: 'October', domain: 'translational', inPerson: false,
    title: 'Communicating Across Boundaries: Writing, Speaking, and Translating Science',
    inquiry: "What makes knowledge about purpose usable — and for whom?",
    before: "Find one example of purpose science research communicated effectively to a non-academic audience. Analyze what makes it work: what was translated, what was preserved, and what — if anything — was lost?",
    after: "Draft a one-page research brief on your emerging project, written for a YSO program director with no social science background. Have a colleague or community partner read it and give you honest feedback before November's convening.",
    description: "Translational researchers must be multilingual in a professional sense — able to write for peer-reviewed journals, speak to practitioners in plain language, and communicate findings to youth, families, and policymakers. This session builds those communication competencies directly, with particular attention to skills that are rarely taught in doctoral programs but are essential for the kind of scholarship this fellowship cultivates.",
    goals: [
      "Develop practical skills for writing about purpose science for non-academic audiences",
      "Practice translating research findings into actionable recommendations for youth-serving organizations",
      "Understand how to build a public scholarship presence that extends the reach of purpose science",
      "Prepare for the November Community Engagement Intensive by developing a clear, accessible summary of your emerging research direction",
    ],
    activities: [
      { text: "Writing workshop: Draft a 300-word plain-language summary of a purpose science finding and receive structured peer feedback", time: "15 min" },
      { text: "Guest practitioner session: A YSO leader discusses what they actually need from researchers — what's useful, what isn't, and how communication style affects trust", time: "20 min" },
      { text: "Practice presentation: Fellows deliver a 5-minute accessible overview of their research interests to a simulated practitioner audience", time: "15 min" },
      { text: "Pre-Intensive preparation: Fellows refine their research summaries and develop 2–3 discussion questions for YSO partners", time: "10 min" },
      { text: "The Multilingual Translation Challenge — Translate the same research finding into three forms: a 280-character social post, a YSO staff brief (one paragraph), and a 30-second parent explanation. Compare what survived each translation.", time: "15 min", isNew: true },
      { text: "Research Communication Audit — Bring one page of your own academic writing and annotate what would need to change (vocabulary, framing, structure) for a non-academic practitioner audience. Generates a personal translation checklist.", time: "15 min", isNew: true },
    ],
    readings: [
      "Selected readings on public scholarship and researcher communication",
      "Examples of effective research-to-practice briefs from the Purpose Commons archives",
    ],
    reflectPrompts: [
      "What do you lose — scientifically or intellectually — in the act of translation? Is that loss acceptable? Necessary?",
      "Who is the hardest audience for you to communicate with effectively — and what does that reveal?",
      "What would it mean for your scholarship to be genuinely useful to the communities you study?",
    ],
    connectsTo: "These communication skills will be tested immediately at the November Community Engagement Intensive. Arrive ready to use them in real partnership conversations.",
  },

  {
    id: 'nov', month: 'November', domain: 'translational', inPerson: true,
    title: 'Community Engagement Intensive',
    inquiry: "What questions are worth pursuing when researchers and communities decide together?",
    before: "Review the Community Fellows' refined research question summaries (distributed in advance). For each, write one sentence on what excites you scientifically and one sentence on what you might need to learn or do differently to pursue it well.",
    after: "Within two weeks of the convening, send a personal follow-up to at least one YSO partner you met. Reflect in the cohort forum: what did you commit to, and what will it require of you?",
    description: "November's in-person Community Engagement Intensive brings Research Fellows together with Community Fellows, additional researchers, youth, and YSO leaders for a multi-day immersive convening. Fellows present their collaborative and individual research projects, receive feedback from the broader network, and deepen the researcher-practitioner relationships that will sustain their work beyond the fellowship year.",
    goals: [
      "Share early-stage research projects and receive substantive feedback from researchers, practitioners, and youth",
      "Deepen relationships with Community Fellows and YSO partners from the Purpose Commons network",
      "Identify emerging themes in the purpose science-practice ecosystem that may inform future research directions",
      "Develop or refine co-design agreements with community partners for ongoing research collaboration",
    ],
    activities: [
      { text: "Research project presentations with structured feedback from mixed researcher-practitioner-youth panels", time: "Varies" },
      { text: "Facilitated cross-track dialogue: What are Community Fellows learning that Research Fellows should know? And vice versa?", time: "45 min" },
      { text: "YSO partnership development sessions: Fellows meet with potential and current community partners to advance formal agreements", time: "60 min" },
      { text: "Network-wide theme identification: Participants collectively surface emerging questions for future fellowship cohorts and the broader field", time: "30 min" },
      { text: "Asset Mapping in Cross-Track Pairs — Research and Community Fellows partner and complete the same structured asset map. They then compare: what unique knowledge, relationships, and access does each bring that the other does not?", time: "30 min", isNew: true },
      { text: "Commitment Letter Draft — Draft a brief formal letter of intent to one YSO partner, specifying one concrete collaboration offer, a realistic timeline, and what you are asking in return. Makes partnership intentions concrete and accountable.", time: "20 min", isNew: true },
    ],
    readings: [
      "Pre-reading: Community Fellows' refined research question summaries (distributed in advance of the convening)",
    ],
    reflectPrompts: [
      "What surprised you most in hearing how community partners and youth talk about purpose?",
      "What commitment did you make at the convening — and what will it actually require of you to keep it?",
      "What did you learn from a Community Fellow that you couldn't have learned from a peer in your discipline?",
    ],
    connectsTo: "The questions that emerge in community partnership are not just research questions — they are the foundation of a fundable agenda. December begins that work.",
  },

  {
    id: 'dec', month: 'December', domain: 'grant', inPerson: false,
    title: 'Grant Development I: Landscape, Strategy, and the Fundable Question',
    inquiry: "What makes a research question fundable — and what makes it worth funding?",
    before: "Read one funded grant abstract in purpose science or a closely adjacent field. Identify the moves the writer makes: how is the problem framed, how is significance established, and how is the question positioned as both important and answerable?",
    after: "Draft your specific aims page or project summary and share it with your Lab of Labs mentor before January's session. In your cover note, identify the one thing you are most uncertain about and the one thing you believe most strongly.",
    description: "The first of two dedicated grant development sessions focuses on the strategic dimensions of research funding: how to read the funding landscape, how to identify alignment between a funder's priorities and your research questions, and how to articulate a research vision that is both scientifically compelling and fundable. Fellows begin developing the conceptual architecture of a grant proposal, grounded in a question co-developed with their community partner.",
    goals: [
      "Navigate the purpose science funding landscape, including federal, foundation, and private sources",
      "Identify 2–3 viable funding opportunities aligned with your emerging research agenda",
      "Understand the anatomy of a competitive grant proposal and what reviewers look for",
      "Draft a preliminary specific aims or project summary that integrates a community-sourced question",
    ],
    activities: [
      { text: "Funding landscape workshop: Survey NIH, NSF, private foundation, and purpose-specific opportunities with guidance from PSiX grant development staff", time: "20 min" },
      { text: "Funder analysis exercise: Select one funding opportunity and analyze its priorities, review criteria, and fit with your research direction", time: "10 min" },
      { text: "Aims drafting workshop: With mentor feedback, draft a preliminary specific aims page or project summary", time: "20 min" },
      { text: "Peer review exercise: Exchange drafts and provide structured critique using a simplified reviewer rubric", time: "15 min" },
      { text: "Funder Persona Role-Play — Fellows are assigned distinct funder personas (NIH study section member, family foundation officer, purpose-specific funder) and evaluate each other's aims from that perspective. Surfaces how framing shifts based on audience.", time: "10 min", isNew: true },
      { text: "Grant Autopsy — Fellows examine a sanitized declined proposal and diagnose reasons for non-funding using a structured protocol. Normalizes revision and builds critical analytical skills.", time: "15 min", isNew: true },
    ],
    readings: [
      "Selected successful grant abstracts from purpose science and adjacent fields (provided by PSiX)",
      "NIH and foundation guidance on proposal writing for early-career researchers",
      "Purpose Commons funding landscape brief (internal)",
    ],
    reflectPrompts: [
      "What is the difference between the question you most want to ask and the question you believe a funder will fund? How will you navigate that?",
      "What makes your community partnership a scientific asset, not just an ethical commitment? How does your aims page reflect that?",
      "What would it mean to build a grant pipeline, not just write one proposal?",
    ],
    connectsTo: "A fundable question is only as strong as the method behind it. January will push you to interrogate the design choices embedded in your specific aims.",
  },

  {
    id: 'jan', month: 'January', domain: 'content', inPerson: false,
    title: 'Research Design, Measurement, and Rigor in Purpose Science',
    inquiry: "How do our design choices shape what we can — and cannot — know about purpose?",
    before: "Select a purpose science study and write a one-page methodological critique: what could this design reveal, and what did its choices foreclose? What would you have done differently, and why?",
    after: "Revisit your emerging research project and write a one-page design rationale: why this method, for this question, with this community? Submit to your mentor as a living document to return to in April.",
    description: "This methodologically focused session deepens fellows' technical competency in purpose science research design. Fellows examine the range of methods used in the field — from survey-based cross-sectional designs to longitudinal, experimental, and qualitative approaches — and explore how to select and justify design choices in the context of community-engaged research. Special attention is given to measurement and instrument validity across diverse populations.",
    goals: [
      "Evaluate the methodological strengths and limitations of major research designs used in purpose science",
      "Critically assess the most widely used purpose measurement instruments and their applicability across populations",
      "Understand how community partnership contexts shape and constrain research design choices",
      "Apply design principles to your own developing research project, with attention to rigor and feasibility",
    ],
    activities: [
      { text: "Methodological deep dive: Select and present a purpose science study, analyzing its design choices and what those choices allow and foreclose", time: "20 min" },
      { text: "Measurement workshop: Hands-on review of the Youth Purpose Survey, Claremont Purpose Scale, and other widely used instruments — what do they measure well, and for whom?", time: "15 min" },
      { text: "Research design consultation with assigned Lab of Labs mentor: Applying methodological principles to your own project", time: "15 min" },
      { text: "Community partner check-in: How does your research design fit the organizational context and timeline of your YSO partner?", time: "10 min" },
      { text: "Method Speed Dating — Rotate through five method stations (survey, interview, longitudinal, experimental, CBPR) and apply each to the same research question for 5 minutes per station. Surfaces hidden methodological assumptions.", time: "15 min", isNew: true },
      { text: "Measure Adaptation Workshop — Take a validated purpose scale and adapt it for a specific community (e.g., rural youth, English Language Learners). What changes? What breaks? What requires co-design with community?", time: "15 min", isNew: true },
    ],
    readings: [
      "Bronk, K. C. (2011). The role of purpose in life in healthy identity formation: A grounded model",
      "Selected psychometric studies on purpose measurement instruments",
      "Readings on mixed-methods and qualitative approaches in community-engaged developmental research",
    ],
    reflectPrompts: [
      "What does your choice of method assume about where purpose 'lives' — in the person, the context, the relationship?",
      "What is the riskiest design choice in your current project — and what makes it worth that risk?",
      "How does your community partner's reality constrain your ideal design? How have you responded to that constraint?",
    ],
    connectsTo: "The design rationale you write this month is the document you will bring to the February Mid-Year Convening for honest assessment.",
  },

  {
    id: 'feb', month: 'February', domain: 'grant', inPerson: true,
    title: 'Research Fellow Mid-Year Convening',
    inquiry: "What is working — and what needs to change?",
    before: "Complete a mid-year self-assessment against your individualized learning plan. Identify one thing you are proud of, one thing that has been harder than expected, and one specific ask you have of the group or your mentors.",
    after: "Update your individualized learning plan based on mid-year feedback. Share with PSiX staff within two weeks.",
    description: "The February Mid-Year Convening is a dedicated checkpoint for Research Fellows — a moment to step back, assess progress, recalibrate learning plans, and workshop grant proposals in a structured peer and mentor environment. This convening is explicitly designed as a feedback and iteration space, not a showcase. Fellows are expected to bring works-in-progress and genuine questions.",
    goals: [
      "Assess progress against individualized learning plan goals and identify areas requiring additional support",
      "Receive structured feedback on developing grant proposals from Lab of Labs mentors and peers",
      "Recalibrate research timelines and community partnership plans for the second half of the fellowship year",
      "Build cohort trust and peer support structures that extend beyond the formal fellowship year",
    ],
    activities: [
      { text: "Grant proposal workshop: Fellows present developing proposals; structured feedback using a reviewer rubric from Lab of Labs mentors", time: "60 min" },
      { text: "Learning plan review: Individual check-ins with PSiX staff to assess progress and adjust goals for the remainder of the year", time: "30 min" },
      { text: "Peer consultation circles: Small groups workshop shared challenges — institutional resistance, partnership friction, methodology questions", time: "40 min" },
      { text: "Field-building dialogue: What does this cohort want to contribute to purpose science, and how does this fellowship get them there?", time: "30 min" },
      { text: "The Honest Dashboard — Create a three-color (green/yellow/red) visual of your key fellowship milestones and share openly. Normalizes struggle, makes support needs visible, and creates permission for honest conversation.", time: "20 min", isNew: true },
      { text: "Revised Success Criteria — Revisit success criteria from your original learning plan and renegotiate any that no longer fit the reality of your work. Distinguishes growth from original intentions.", time: "20 min", isNew: true },
    ],
    readings: [
      "Fellows' own draft grant materials (peer review preparation)",
      "Purpose Commons reflective practice framework documentation (internal)",
    ],
    reflectPrompts: [
      "What has been genuinely harder than you expected — and what does that tell you about what you still need to learn?",
      "What is the most important thing you would tell yourself at the beginning of the fellowship year?",
      "What specific support do you need in the second half — and who will you ask for it?",
    ],
    connectsTo: "Research rigor is necessary but not sufficient. The Mid-Year Convening makes clear that where you work matters as much as how you work. March turns to the institutional terrain.",
  },

  {
    id: 'mar', month: 'March', domain: 'translational', inPerson: false,
    title: 'Institutional Navigation: Building a Purpose Science Program at Your Home Institution',
    inquiry: "What is possible within my institution — and how might I expand those possibilities?",
    before: "Draw a simple map of your institution: who are the people, structures, and norms that shape what you can do? Mark where purpose science work currently fits — and where you want it to fit.",
    after: "Share your 12-month institutional action plan with one trusted colleague at your home institution. Note their reaction: what encouraged them, what surprised them, what raised concerns? Bring those observations to April's session.",
    description: "This session addresses one of the most practical and underestimated challenges facing early-career faculty: navigating the institutional terrain of their own university. Building a purpose science research program requires understanding promotion and tenure structures, cultivating internal champions, managing teaching loads, and making the case for community-engaged scholarship to colleagues who may be skeptical.",
    goals: [
      "Map the institutional landscape at your home university — who are the allies, the skeptics, and the gatekeepers?",
      "Understand how to make the case for community-engaged scholarship within traditional academic evaluation frameworks",
      "Develop a personalized institutional action plan for the year following the fellowship",
      "Build peer support structures with cohort members facing similar institutional contexts",
    ],
    activities: [
      { text: "Institutional mapping exercise: Diagram the key relationships, structures, and decision points relevant to building a purpose science program at your home institution", time: "15 min" },
      { text: "Case studies: Senior researchers share their experiences navigating institutional resistance and support for community-engaged scholarship", time: "20 min" },
      { text: "Action planning workshop: Draft a 12-month institutional action plan, reviewed by PSiX staff and mentors", time: "15 min" },
      { text: "Peer consultation: Fellows with similar institutional contexts workshop shared strategies", time: "10 min" },
      { text: "Ally Interview Debrief — Between sessions, conduct a 20-minute structured conversation with a senior colleague about how community-engaged scholarship is perceived at your institution. Session opens with cross-cohort debrief of findings.", time: "15 min", isNew: true },
      { text: "The Skeptic's Pitch — Practice a 3-minute case for purpose science and community-engaged scholarship to a resistant colleague, with peers playing the skeptic role. Builds persuasive fluency and resilience across disciplinary difference.", time: "15 min", isNew: true },
    ],
    readings: [
      "Selected readings on tenure and promotion for community-engaged scholars",
      "Boyer, E. L. (1996). The scholarship of engagement",
      "PSiX institutional navigation brief (internal)",
    ],
    reflectPrompts: [
      "Who at your institution has the most power to help your purpose science work — and do they know you well enough to advocate for you?",
      "What is the most significant institutional constraint you face, and what is your strategy for navigating it?",
      "What would you need to do or demonstrate in the next 12 months to make community-engaged scholarship legible as rigorous scholarship in your context?",
    ],
    connectsTo: "Your institutional action plan and your grant proposal are not separate projects — they are the same argument addressed to different audiences. April brings both together.",
  },

  {
    id: 'apr', month: 'April', domain: 'grant', inPerson: false,
    title: 'Grant Development II: Writing, Revising, and Submitting',
    inquiry: "What does it take to move from idea to compelling proposal — and what does that process reveal about what you actually believe?",
    before: "Circulate your near-complete grant proposal to your cohort peers and mentor at least one week before the session. In your cover note, identify the section you are least confident about and the central argument you most want to pressure-test.",
    after: "Revise and finalize your grant proposal incorporating workshop feedback. Identify your submission target and submit — or commit to a submission date — within 60 days of the session.",
    description: "The second grant development session shifts from strategy to craft. Fellows bring substantially developed proposals and work through the writing, revision, and submission process with intensive peer and mentor support. The session addresses the specific writing demands of grant proposals — clarity of argument, specificity of design, responsiveness to reviewer concerns — and prepares fellows to submit a competitive proposal within or immediately following the fellowship year.",
    goals: [
      "Produce a substantially complete, reviewer-ready grant proposal in purpose science",
      "Develop skills in responding to reviewer feedback and revising proposals for resubmission",
      "Understand the administrative and institutional requirements for grant submission at your home institution",
      "Build a sustainable grant development practice — not just one proposal, but a pipeline",
    ],
    activities: [
      { text: "Full proposal workshop: Fellows circulate near-complete proposals in advance; session devoted to line-by-line feedback from mentors and peers", time: "25 min" },
      { text: "Revision sprint: Focused time revising based on workshop feedback with real-time support available", time: "15 min" },
      { text: "Submission preparation: PSiX grant development staff walk fellows through institutional submission requirements, IRB considerations, and budget development", time: "15 min" },
      { text: "Pipeline planning: Identify 2–3 additional funding opportunities and develop a 12-month submission calendar", time: "10 min" },
      { text: "Simulated Panel Review — Form mock study sections and score each other's proposals using an actual NIH or foundation review rubric. Debrief from both sides of the table: what did it feel like to review, and what did that reveal about your own proposal?", time: "15 min", isNew: true },
      { text: "Resubmission Resilience Memo — Draft a 'response to anticipated reviewer concerns' memo for your own proposal, pre-empting likely critiques. Builds strategic thinking and normalizes revision as part of the process.", time: "10 min", isNew: true },
    ],
    readings: [
      "Fellows' own grant proposals (peer review preparation)",
      "Selected readings on grant writing craft and common reviewer critiques",
      "NIH review criteria guidance and foundation RFP examples",
    ],
    reflectPrompts: [
      "What central claim are you making in this proposal — and do you genuinely believe it?",
      "What is the most likely reason a reviewer would decline your proposal? How have you addressed that in the revision?",
      "What does it mean to build a grant pipeline, not just write one proposal? What is your next submission after this one?",
    ],
    connectsTo: "The grant you are drafting is the research program you want to teach. May's session will ask you to make that connection explicit — and to begin building the course that carries your scholarship forward.",
  },

  {
    id: 'may', month: 'May', domain: 'teaching', inPerson: false,
    title: 'Course Design and Teaching Purpose Science',
    inquiry: "How can I teach purpose in a way that enables others to build — not just understand?",
    before: "Think of a course you took that changed how you think — not just what you know. What did the instructor do? How was it designed? Write a paragraph on what you want to carry forward into your own teaching of purpose science.",
    after: "Finalize your capstone portfolio — research plan, community partnership documentation, grant proposal, institutional action plan, and course syllabus — in preparation for the June Culminating Symposium. Share a draft with your mentor before the symposium.",
    description: "The final monthly session is devoted to the teaching mission — the downstream multiplier that distinguishes this fellowship from others. Fellows finalize their purpose science course syllabus or module, practice teaching core concepts to peer audiences, and develop strategies for getting new courses approved at their home institutions. This session also serves as capstone preparation.",
    goals: [
      "Complete a full, implementation-ready syllabus or course module in purpose science for your home institution",
      "Develop and practice teaching at least one core purpose science concept to a non-specialist audience",
      "Identify the pathway to course approval and implementation at your home institution",
      "Synthesize the year's learning in preparation for the Culminating Symposium capstone presentation",
    ],
    activities: [
      { text: "Syllabus workshop: Share draft syllabi; structured peer and mentor feedback on content, sequencing, and pedagogical approach", time: "15 min" },
      { text: "Teaching demonstration: Each fellow delivers a 10-minute micro-lesson on a purpose science concept; cohort provides feedback using a structured observation protocol", time: "25 min" },
      { text: "Institutional pathway planning: Map the specific steps required to get your course approved and scheduled at your home institution", time: "10 min" },
      { text: "Capstone preparation: Develop your Culminating Symposium presentation, integrating research plan, community partnership, grant proposal, and course design into a coherent vision", time: "15 min" },
      { text: "Purpose Science Teaching Philosophy Statement — Draft a 250-word teaching philosophy specific to purpose science, articulating what you believe students should be able to do — not just know — by the end of your course.", time: "15 min", isNew: true },
      { text: "Letter to Next Year's Fellow — Write a 300-word letter to an incoming Research Fellow, sharing what you wish you had known at the start and what the fellowship most changed in your thinking, research practice, or sense of yourself as a scholar.", time: "10 min", isNew: true },
    ],
    readings: [
      "Selected readings on course design in the social sciences",
      "Examples of purpose science syllabi from PSiX network institutions (internal)",
      "Fink, L. D. (2003). Creating Significant Learning Experiences — selected chapters",
    ],
    reflectPrompts: [
      "What do you believe students should be able to do — not just know — after taking a course in purpose science?",
      "What is the most important thing you learned this year that you want to teach forward?",
      "Who will you be as a scholar-practitioner one year from now? What will you be building?",
    ],
    connectsTo: "Everything produced this year — research plan, community partnerships, grant proposal, course syllabus — comes together in June. The Culminating Symposium is the first audience for your full vision.",
  },

  {
    id: 'jun', month: 'June', domain: 'all', inPerson: true,
    title: 'Culminating Symposium',
    inquiry: "What am I now positioned to build next?",
    before: "Review your individualized learning plan from the start of the year alongside your capstone portfolio. Write a two-page narrative: How have you changed as a scholar and practitioner? What do you now believe that you did not before?",
    after: "This is the final inquiry — but it is not the last question. The Culminating Symposium marks the beginning of the next phase of your work. Carry your guiding inquiry forward.",
    description: "The June Culminating Symposium marks the close of the formal fellowship year and the opening of everything the fellowship has been building toward. Fellows present their capstone portfolios — integrating their translational research statement, community partnership documentation, grant proposal, institutional action plan, and course syllabus — to an audience of Lab of Labs researchers, Purpose Commons partners, and invited guests. The symposium is not a defense. It is a demonstration.",
    goals: [
      "Present a coherent capstone portfolio integrating all four fellowship domains",
      "Receive feedback from the broader PSiX network — researchers, practitioners, and community partners — on the work as a whole",
      "Articulate a clear vision of the scholarship and teaching program you are now positioned to build",
      "Celebrate one year of rigorous, purposeful, community-grounded work with your cohort",
    ],
    activities: [
      { text: "Capstone portfolio presentations: Research plan, community partnership documentation, grant proposal, institutional action plan, and course syllabus", time: "Varies" },
      { text: "Structured feedback from Lab of Labs researchers and Purpose Commons partners", time: "Varies" },
      { text: "Network reception: Fellows and mentors across cohort years share work and build enduring connections", time: "Open" },
      { text: "Cohort reflection: What has this year produced — individually and collectively — for the purpose science field?", time: "30 min" },
    ],
    readings: [
      "Fellows' own capstone portfolios (distributed in advance to reviewers)",
    ],
    reflectPrompts: [
      "Looking at the full arc of the year: what question are you leaving with that you didn't arrive with?",
      "What does your capstone portfolio say about who you are as a scholar? Does it feel true?",
      "What will you build in the next year that would not have been possible without this fellowship?",
    ],
    connectsTo: null,
  },
];

export const PORTFOLIO_ARTIFACTS = [
  {
    sessionId: 'jul',
    label: 'Working definition of purpose',
    component: 'Conceptual foundation',
    purpose: 'Names the definition of purpose you are willing to use, critique, and defend in your own work.',
    prompt: 'Write a concise working definition of purpose and note what it includes, excludes, and makes possible.'
  },
  {
    sessionId: 'aug',
    label: 'Equity-centered research provocation',
    component: 'Research question',
    purpose: 'Identifies a gap in the field that your context, population, or partnership can help the fellowship take seriously.',
    prompt: 'Frame one literature gap and explain whose experience becomes more visible if the field studies it well.'
  },
  {
    sessionId: 'sep',
    label: 'Partnership philosophy statement',
    component: 'Translation stance',
    purpose: 'Clarifies how you want to work with communities, not only what you want to study in them.',
    prompt: 'Describe your commitments around trust, power, pace, reciprocity, and shared decision-making.'
  },
  {
    sessionId: 'oct',
    label: 'Research translation checklist',
    component: 'Communication practice',
    purpose: 'Turns your scholarship into language that practitioners, families, youth, and institutional partners can use.',
    prompt: 'Create a personal checklist for translating one piece of academic writing into public or practitioner-facing language.'
  },
  {
    sessionId: 'nov',
    label: 'Community partnership commitment letter',
    component: 'Partnership evidence',
    purpose: 'Makes one collaboration concrete by naming the offer, ask, timeline, and mutual value.',
    prompt: 'Draft a brief letter of intent to a current or potential YSO partner.'
  },
  {
    sessionId: 'dec',
    label: 'Specific aims or project summary draft',
    component: 'Funding architecture',
    purpose: 'Begins translating the partnership-sourced question into a fundable scholarly project.',
    prompt: 'Draft a one-page aims page or project summary and mark the claim you most want feedback on.',
    format: 'aims'
  },
  {
    sessionId: 'jan',
    label: 'Research design rationale',
    component: 'Methodological warrant',
    purpose: 'Explains why this method fits this question, this community, and this stage of the work.',
    prompt: 'Write a one-page rationale for your proposed method, measures, sample, and partnership constraints.'
  },
  {
    sessionId: 'feb',
    label: 'Revised learning plan',
    component: 'Mid-year recalibration',
    purpose: 'Turns feedback and lived experience into a realistic plan for the second half of the fellowship.',
    prompt: 'Update your learning plan with revised priorities, support needs, and concrete next steps.'
  },
  {
    sessionId: 'mar',
    label: 'Institutional action plan',
    component: 'Local implementation',
    purpose: 'Maps how the work can survive and grow inside your actual institutional context.',
    prompt: 'Draft a 12-month action plan naming allies, constraints, decision points, and near-term moves.',
    format: 'timeline'
  },
  {
    sessionId: 'apr',
    label: 'Reviewer-ready grant proposal',
    component: 'Funding product',
    purpose: 'Produces the strongest version of the proposal you are prepared to submit or revise into submission.',
    prompt: 'Revise the proposal using peer, mentor, and reviewer-style feedback.'
  },
  {
    sessionId: 'may',
    label: 'Purpose science course module',
    component: 'Teaching product',
    purpose: 'Builds the course, module, or teaching unit that carries the fellowship work into your classroom.',
    prompt: 'Finalize a teachable module or syllabus segment with learning goals, sequence, and assignments.',
    format: 'slides'
  },
  {
    sessionId: 'jun',
    label: 'Capstone portfolio narrative',
    component: 'Synthesis',
    purpose: 'Connects the artifacts into a coherent account of the scholar, partner, teacher, and field-builder you are becoming.',
    prompt: 'Write the narrative that explains what your portfolio demonstrates and what you are positioned to build next.'
  }
];

export const CAPSTONE_COMPONENTS = [
  {
    id: 'research-plan',
    title: 'Research Plan',
    description: 'The scholarly foundation: what you mean by purpose, the question you are pursuing, and the design that will answer it.',
    sessionIds: ['jul', 'aug', 'dec', 'jan'],
  },
  {
    id: 'partnership-documentation',
    title: 'Community Partnership Documentation',
    description: 'How you work with communities, made concrete in a specific, mutual commitment with a partner.',
    sessionIds: ['sep', 'nov'],
  },
  {
    id: 'grant-proposal',
    title: 'Grant Proposal',
    description: "The fundable version of your research plan, revised through peer, mentor, and reviewer feedback.",
    sessionIds: ['dec', 'jan', 'apr'],
  },
  {
    id: 'institutional-action-plan',
    title: 'Institutional Action Plan',
    description: 'A realistic plan for how the work survives and grows inside your actual institution.',
    sessionIds: ['feb', 'mar'],
  },
  {
    id: 'teaching-module',
    title: 'Course or Teaching Module',
    description: "The fellowship's ideas translated into something you can actually teach.",
    sessionIds: ['oct', 'may'],
  },
  {
    id: 'capstone-narrative',
    title: 'Capstone Narrative',
    description: 'The synthesis that connects every thread above into one account of the scholar, partner, and teacher you are becoming.',
    sessionIds: ['jul', 'aug', 'sep', 'oct', 'nov', 'dec', 'jan', 'feb', 'mar', 'apr', 'may', 'jun'],
  },
];

export const DOSSIER_SECTIONS = [
  {
    componentId: 'research-plan',
    dossierSection: 'Research Statement',
    guidance: "Your research statement needs a clear throughline: what you study, why it matters, and what you're positioned to do next. Your definition (July), research question (August), specific aims (December), and design rationale (January) are the raw material for that throughline — most of the intellectual work of a research statement is already sitting in these four artifacts.",
  },
  {
    componentId: 'partnership-documentation',
    dossierSection: 'Community Engagement / Broader Impacts',
    guidance: 'Many institutions now have a formal engagement or broader-impacts section — some require it for tenure. Your partnership philosophy (September) and commitment letter (November) are direct evidence of sustained, reciprocal community engagement, not just a single outreach event.',
  },
  {
    componentId: 'grant-proposal',
    dossierSection: 'Grants & Funding (CV section + Research Statement)',
    guidance: 'List the proposal itself on your CV under "Grants Submitted" or "Grants Awarded," and use the revision story — what a reviewer flagged, what you changed — as evidence in your research statement of a fundable, field-tested research plan.',
  },
  {
    componentId: 'institutional-action-plan',
    dossierSection: 'Service Statement',
    guidance: 'Institutional and departmental service is notoriously hard to document well. Your action plan (March) already names the allies, constraints, and concrete moves — reframe this as your service narrative: what you changed or built inside your institution, not just what committees you sat on.',
  },
  {
    componentId: 'teaching-module',
    dossierSection: 'Teaching Statement / Teaching Portfolio',
    guidance: 'Your translation checklist (October) and course module (May) are teaching artifacts, not just fellowship artifacts. Most teaching statements stay vague about pedagogy — yours can point to an actual designed unit with learning goals and assignments.',
  },
  {
    componentId: 'capstone-narrative',
    dossierSection: 'Cover / Personal Statement',
    guidance: 'Many dossiers open with a short narrative connecting research, teaching, and service into one account of who you are as a scholar. Your capstone narrative (June) is a first draft of exactly that document — written a year before you actually need it.',
  },
];

export const FUNDING_OPPORTUNITIES = [
  {
    name: 'NIH R21 (Exploratory/Developmental Research Grant)',
    fit: 'Early-stage, high-risk/high-reward studies — a good fit for a first study on an understudied population or mechanism.',
    cadence: 'Standard NIH due dates: Feb 16, Jun 16, Oct 16 each year (check the specific funding opportunity announcement for exact dates).',
    link: 'https://grants.nih.gov/grants/funding/r21.htm',
  },
  {
    name: 'NIH R01 (Research Project Grant)',
    fit: 'The standard NIH mechanism for a fully-powered research program — typically pursued after pilot data (e.g., from an R21 or foundation grant).',
    cadence: 'Standard NIH due dates: Feb 5, Jun 5, Oct 5 (new submissions); check cycle-specific FOAs.',
    link: 'https://grants.nih.gov/grants/how-to-apply-application-guide/due-dates-and-submission-policies/due-dates.htm',
  },
  {
    name: 'NSF Developmental Sciences / Human Networks & Data Science',
    fit: 'Basic research on developmental processes, including purpose, identity, and motivation — no clinical/health framing required.',
    cadence: 'NSF programs typically post target dates or windows annually; check the specific program page each cycle.',
    link: 'https://www.nsf.gov/funding',
  },
  {
    name: 'William T. Grant Foundation',
    fit: 'Research on reducing inequality or improving the use of research evidence — strong fit for community-partnered, equity-centered purpose research.',
    cadence: 'Letters of inquiry typically due in the spring and fall; check the foundation site for the current cycle.',
    link: 'https://wtgrantfoundation.org/',
  },
  {
    name: 'Spencer Foundation',
    fit: 'Education research broadly construed — a strong fit for purpose-in-education and youth-development framings.',
    cadence: 'Small and large research grant programs run on rolling or annual cycles; check current guidelines.',
    link: 'https://www.spencer.org/',
  },
  {
    name: 'Local/institutional seed grants',
    fit: "Nearly every university has some form of internal seed funding (office of research, college-level, or center-specific). Often the fastest path to pilot funding, and usually the most winnable given local competition.",
    cadence: 'Varies by institution — check your office of research.',
    link: '',
  },
];

