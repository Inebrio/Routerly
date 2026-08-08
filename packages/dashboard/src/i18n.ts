import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import en from './locales/en.json';
import es from './locales/es.json';
import ar from './locales/ar.json';
import az from './locales/az.json';
import bg from './locales/bg.json';
import bn from './locales/bn.json';
import cs from './locales/cs.json';
import da from './locales/da.json';
import de from './locales/de.json';
import fa from './locales/fa.json';
import fi from './locales/fi.json';
import fil from './locales/fil.json';
import fr from './locales/fr.json';
import gu from './locales/gu.json';
import he from './locales/he.json';
import hi from './locales/hi.json';
import hu from './locales/hu.json';
import id from './locales/id.json';
import it from './locales/it.json';
import ja from './locales/ja.json';
import ko from './locales/ko.json';
import mr from './locales/mr.json';
import ms from './locales/ms.json';
import nl from './locales/nl.json';
import no from './locales/no.json';
import pl from './locales/pl.json';
import pt from './locales/pt.json';
import ptBR from './locales/pt-BR.json';
import ro from './locales/ro.json';
import ru from './locales/ru.json';
import sk from './locales/sk.json';
import sv from './locales/sv.json';
import sw from './locales/sw.json';
import ta from './locales/ta.json';
import te from './locales/te.json';
import th from './locales/th.json';
import tr from './locales/tr.json';
import uk from './locales/uk.json';
import ur from './locales/ur.json';
import vi from './locales/vi.json';
import zh from './locales/zh.json';

// ponytail: catalogs are static-imported one by one; each new locale's json
// lands here as it's produced, no dynamic-import machinery for ~40 files.
const resources = {
  en: { translation: en },
  es: { translation: es },
  ar: { translation: ar },
  az: { translation: az },
  bg: { translation: bg },
  bn: { translation: bn },
  cs: { translation: cs },
  da: { translation: da },
  de: { translation: de },
  fa: { translation: fa },
  fi: { translation: fi },
  fil: { translation: fil },
  fr: { translation: fr },
  gu: { translation: gu },
  he: { translation: he },
  hi: { translation: hi },
  hu: { translation: hu },
  id: { translation: id },
  it: { translation: it },
  ja: { translation: ja },
  ko: { translation: ko },
  mr: { translation: mr },
  ms: { translation: ms },
  nl: { translation: nl },
  no: { translation: no },
  pl: { translation: pl },
  pt: { translation: pt },
  'pt-BR': { translation: ptBR },
  ro: { translation: ro },
  ru: { translation: ru },
  sk: { translation: sk },
  sv: { translation: sv },
  sw: { translation: sw },
  ta: { translation: ta },
  te: { translation: te },
  th: { translation: th },
  tr: { translation: tr },
  uk: { translation: uk },
  ur: { translation: ur },
  vi: { translation: vi },
  zh: { translation: zh },
};

i18n
  .use(initReactI18next)
  .init({
    resources,
    fallbackLng: 'en', // AC4: a missing key falls back to the English resource, never a raw key
    interpolation: { escapeValue: false },
  });

export default i18n;
