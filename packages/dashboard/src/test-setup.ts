import '@testing-library/jest-dom'
import { afterEach } from 'vitest'
import './i18n'

// Filters and date ranges persist in localStorage, and jsdom keeps one store for
// the whole file: without this, what a test picks in the picker is still picked
// in the next test. Cleared after each test, so a test that seeds the store in
// its own setup still sees it.
afterEach(() => localStorage.clear())
