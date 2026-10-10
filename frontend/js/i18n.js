/* CivicMind — civilian portal labels in English, Hindi and Marathi.
   Only fixed interface text lives here; user and server text is never translated in the
   browser. Hindi/Marathi strings should be reviewed by native speakers before production. */
const I18N = (() => {
  const S = {
    en: {
      hello: 'Hello', intro: "Report a civic problem and follow it until it's resolved.", language: 'Language',
      m_mine: 'My reports', m_progress: 'Being handled', m_resolved: 'Resolved', m_joined: "Incidents I'm part of",
      report_title: 'Report a civic issue', category: 'Category', choose_category: 'Choose a category…',
      photo: 'Photo', optional: '(optional)', required: '(required)',
      photo_hint: 'JPEG, PNG or WebP, up to 5 MB. Location data inside the photo is removed.',
      problem: 'What is the problem?', desc_hint: 'at least 10 characters',
      check: 'Check my report (optional)',
      check_hint: 'Suggests a category and, if available, an English translation. Nothing is submitted until you press Submit.',
      address: 'Landmark / address (optional)', location: 'Location',
      loc_hint: 'Tap the map or drag the pin to the exact spot.', use_location: '📍 Use my location',
      submit: 'Submit report', updates: 'Updates', track: 'Track with a code', my_reports: 'My reports',
      a_title: 'Suggestion — please review', a_suggested: 'Suggested category', a_use: 'Use this category',
      a_used: 'Category set', a_severity: 'Suggested severity', a_urgency: 'Urgency signs',
      a_questions: 'Details that would help (add them to your description if you can)',
      a_places: 'Places mentioned — the map pin decides the location',
      a_translation: 'English translation — review and edit. It is stored separately; your original words are kept.',
      a_include: 'I have checked this translation; include it with my report',
      a_mismatch: 'Your text looks like a different language than the one selected.',
      a_rules: 'Rule-based suggestion', a_ai: 'AI-assisted suggestion', a_review: 'Please review everything before you submit.',
      a_too_short: 'Write at least 10 characters first.',
      a_stale: 'Your text changed after the check. Run the check again to refresh the suggestion and translation.',
    },
    hi: {
      hello: 'नमस्ते', intro: 'नागरिक समस्या दर्ज करें और समाधान तक उसकी स्थिति देखें।', language: 'भाषा',
      m_mine: 'मेरी शिकायतें', m_progress: 'कार्यवाही जारी', m_resolved: 'हल हुई', m_joined: 'मेरी शिकायतों से जुड़ी घटनाएँ',
      report_title: 'नागरिक समस्या दर्ज करें', category: 'श्रेणी', choose_category: 'श्रेणी चुनें…',
      photo: 'फ़ोटो', optional: '(वैकल्पिक)', required: '(आवश्यक)',
      photo_hint: 'JPEG, PNG या WebP, अधिकतम 5 MB। फ़ोटो में मौजूद स्थान की जानकारी हटा दी जाती है।',
      problem: 'समस्या क्या है?', desc_hint: 'कम से कम 10 अक्षर',
      check: 'मेरी शिकायत जाँचें (वैकल्पिक)',
      check_hint: 'श्रेणी और (उपलब्ध हो तो) अंग्रेज़ी अनुवाद सुझाता है। सबमिट दबाने तक कुछ भी नहीं भेजा जाता।',
      address: 'पहचान चिह्न / पता (वैकल्पिक)', location: 'स्थान',
      loc_hint: 'मानचित्र पर टैप करें या पिन को सही जगह पर खींचें।', use_location: '📍 मेरा स्थान उपयोग करें',
      submit: 'शिकायत भेजें', updates: 'अपडेट', track: 'कोड से ट्रैक करें', my_reports: 'मेरी शिकायतें',
      a_title: 'सुझाव — कृपया जाँचें', a_suggested: 'सुझाई गई श्रेणी', a_use: 'यह श्रेणी चुनें',
      a_used: 'श्रेणी चुनी गई', a_severity: 'सुझाई गई गंभीरता', a_urgency: 'तात्कालिकता के संकेत',
      a_questions: 'ये जानकारी मदद करेगी (हो सके तो विवरण में जोड़ें)',
      a_places: 'उल्लिखित स्थान — स्थान मानचित्र पिन से तय होता है',
      a_translation: 'अंग्रेज़ी अनुवाद — जाँचें और सुधारें। यह अलग से सहेजा जाता है; आपके मूल शब्द सुरक्षित रहते हैं।',
      a_include: 'मैंने अनुवाद जाँच लिया है; इसे मेरी शिकायत के साथ शामिल करें',
      a_mismatch: 'आपका लेख चुनी गई भाषा से अलग लगता है।',
      a_rules: 'नियम-आधारित सुझाव', a_ai: 'AI-सहायता प्राप्त सुझाव', a_review: 'सबमिट करने से पहले सब कुछ जाँच लें।',
      a_too_short: 'पहले कम से कम 10 अक्षर लिखें।',
      a_stale: 'जाँच के बाद आपका लेख बदल गया है। सुझाव और अनुवाद अपडेट करने के लिए फिर से जाँचें।',
    },
    mr: {
      hello: 'नमस्कार', intro: 'नागरी समस्या नोंदवा आणि ती सुटेपर्यंत तिचा मागोवा घ्या.', language: 'भाषा',
      m_mine: 'माझ्या तक्रारी', m_progress: 'काम सुरू आहे', m_resolved: 'सोडवलेल्या', m_joined: 'माझ्या तक्रारींशी संबंधित घटना',
      report_title: 'नागरी समस्या नोंदवा', category: 'प्रकार', choose_category: 'प्रकार निवडा…',
      photo: 'फोटो', optional: '(ऐच्छिक)', required: '(आवश्यक)',
      photo_hint: 'JPEG, PNG किंवा WebP, जास्तीत जास्त 5 MB. फोटोमधील स्थानाची माहिती काढून टाकली जाते.',
      problem: 'समस्या काय आहे?', desc_hint: 'किमान 10 अक्षरे',
      check: 'माझी तक्रार तपासा (ऐच्छिक)',
      check_hint: 'प्रकार आणि (उपलब्ध असल्यास) इंग्रजी भाषांतर सुचवते. सबमिट दाबेपर्यंत काहीही पाठवले जात नाही.',
      address: 'खूण / पत्ता (ऐच्छिक)', location: 'ठिकाण',
      loc_hint: 'नकाशावर टॅप करा किंवा पिन योग्य ठिकाणी ओढा.', use_location: '📍 माझे ठिकाण वापरा',
      submit: 'तक्रार पाठवा', updates: 'अपडेट्स', track: 'कोडने ट्रॅक करा', my_reports: 'माझ्या तक्रारी',
      a_title: 'सूचना — कृपया तपासा', a_suggested: 'सुचवलेला प्रकार', a_use: 'हा प्रकार वापरा',
      a_used: 'प्रकार निवडला', a_severity: 'सुचवलेली तीव्रता', a_urgency: 'तातडीची चिन्हे',
      a_questions: 'ही माहिती उपयोगी ठरेल (शक्य असल्यास वर्णनात जोडा)',
      a_places: 'उल्लेख केलेली ठिकाणे — ठिकाण नकाशावरील पिनने ठरते',
      a_translation: 'इंग्रजी भाषांतर — तपासा आणि दुरुस्त करा. ते स्वतंत्रपणे जतन होते; तुमचे मूळ शब्द तसेच राहतात.',
      a_include: 'मी भाषांतर तपासले आहे; ते माझ्या तक्रारीसोबत समाविष्ट करा',
      a_mismatch: 'तुमचा मजकूर निवडलेल्या भाषेपेक्षा वेगळ्या भाषेत दिसतो.',
      a_rules: 'नियमांवर आधारित सूचना', a_ai: 'AI-सहाय्यित सूचना', a_review: 'सबमिट करण्यापूर्वी सर्व तपासा.',
      a_too_short: 'आधी किमान 10 अक्षरे लिहा.',
      a_stale: 'तपासणीनंतर तुमचा मजकूर बदलला आहे. सूचना आणि भाषांतर अद्ययावत करण्यासाठी पुन्हा तपासा.',
    },
  };
  const LANGS = [['en', 'English'], ['hi', 'हिन्दी'], ['mr', 'मराठी']];
  let current = 'en';
  const t = (key) => (S[current] && S[current][key]) || S.en[key] || key;
  function apply(lang, root = document) {
    current = S[lang] ? lang : 'en';
    document.documentElement.lang = current;
    root.querySelectorAll('[data-i18n]').forEach(el => { el.textContent = t(el.getAttribute('data-i18n')); });
    return current;
  }
  return { t, apply, LANGS, get lang() { return current; } };
})();
