import { describe, it, expect } from 'vitest';
import { isAbaRouting, isIban, isBic, isEin, isKnownEinPrefix, isSsnOrItin, isEmail, isUrl, isUsPostal, isIsoDate, matchesFormat } from '../src/validation/validators.js';

describe('validators', () => {
  it('ABA routing checksum', () => {
    for (const ok of ['111000614', '026009593', '042000314', '021000089', '011000015', '051504759']) expect(isAbaRouting(ok), ok).toBe(true);
    for (const bad of ['123456789', '111000615', '12345678', '0260095930', '000000000', 'abcdefghi']) expect(isAbaRouting(bad), bad).toBe(false);
  });
  it('IBAN mod-97', () => {
    for (const ok of ['GB82WEST12345698765432', 'DE89370400440532013000', 'FR1420041010050500013M02606', 'gb82 west 1234 5698 7654 32']) expect(isIban(ok), ok).toBe(true);
    for (const bad of ['GB82WEST12345698765433', 'DE8937040044053201300', 'XX00', '1234567890']) expect(isIban(bad), bad).toBe(false);
  });
  it('SWIFT/BIC is 8 or 11 characters', () => {
    for (const ok of ['CITIUS33', 'FTBCUS3C', 'DEUTDEFF500', 'BOFAUS3NXXX']) expect(isBic(ok), ok).toBe(true);
    for (const bad of ['CITIUS3', 'CITIUS33X', 'C1TIUS33', 'DEUTDEFF5000']) expect(isBic(bad), bad).toBe(false);
  });
  it('EIN format and prefix', () => {
    expect(isEin('12-3456789')).toBe(true);
    expect(isEin('123456789')).toBe(true);
    expect(isEin('1234')).toBe(false);
    expect(isEin('123-45-6789')).toBe(false);
    expect(isKnownEinPrefix('12-3456789')).toBe(true);
    expect(isKnownEinPrefix('07-1234567')).toBe(false);
  });
  it('SSN and ITIN format', () => {
    for (const ok of ['123-45-6789', '123456789', '912-70-1234']) expect(isSsnOrItin(ok), ok).toBe(true);
    for (const bad of ['000-12-3456', '666-12-3456', '123-00-4567', '123-45-0000', '912-12-1234', '12-3456789']) expect(isSsnOrItin(bad), bad).toBe(false);
  });
  it('email, URL, US postal, dates, and Bank Rules formats', () => {
    expect(isEmail('ap@northwindlogistics.example')).toBe(true);
    expect(isEmail('owner@baddata')).toBe(false);
    expect(isEmail('a b@c.com')).toBe(false);
    expect(isUrl('https://www.example.com/path')).toBe(true);
    expect(isUrl('www.example.com')).toBe(true);
    expect(isUrl('not a url')).toBe(false);
    expect(isUsPostal('75202')).toBe(true);
    expect(isUsPostal('43215-1234')).toBe(true);
    expect(isUsPostal('7870')).toBe(false);
    expect(isUsPostal('871222')).toBe(false);
    expect(isIsoDate('2026-02-28')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('02/28/2026')).toBe(false);
    expect(matchesFormat('123456', '[0-9]{6}|[0-9]{2}-[0-9]{2}-[0-9]{2}')).toBe(true);
    expect(matchesFormat('12-34-56', '[0-9]{6}|[0-9]{2}-[0-9]{2}-[0-9]{2}')).toBe(true);
    expect(matchesFormat('1234567', '[0-9]{6}|[0-9]{2}-[0-9]{2}-[0-9]{2}')).toBe(false);
  });
});
