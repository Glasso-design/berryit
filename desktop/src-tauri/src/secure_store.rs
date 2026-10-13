//! Säker lagring av sessionstoken i Windows Credential Manager.
//!
//! Supabase-klienten i webbläsarmiljö lagrar normalt sessionen i
//! `localStorage`. I en desktopapp är det fel: filen ligger kvar på disk i
//! klartext och kan läsas av vilket program som helst som kör som användaren.
//! Här går lagringen i stället genom `keyring`, som på Windows använder
//! Credential Manager. Hemligheten skyddas då av användarens inloggning (DPAPI)
//! och syns inte i appens filer.
//!
//! Nycklarna namnrymdssepareras per tjänst så att flera miljöer kan samsas.

use keyring::Entry;
use serde::Serialize;

const SERVICE: &str = "se.berryit.controlcenter";

/// Windows Credential Manager tar högst 2560 *byte* per post. Felmeddelandet
/// från plattformen talar om tecken, men gränsen räknas i byte, och UTF-16 ger
/// två byte per enhet – alltså 1280 enheter. Här används 1000 med marginal.
///
/// En Supabase-session (access-token, refresh-token och användarobjekt) är
/// större än så och delas därför upp i flera poster.
const MAX_UNITS: usize = 1000;

/// Rubrik i huvudposten när värdet är uppdelat.
const CHUNK_PREFIX: &str = "berryit-chunks:";

/// Hur många delposter som som mest städas bort vid skrivning och radering.
/// Räcker för en session många gånger större än dagens.
const MAX_CHUNKS: usize = 256;

fn chunk_key(key: &str, index: usize) -> String {
    format!("{key}.{index}")
}

/// Delar strängen i bitar om högst MAX_UNITS UTF-16-enheter, utan att klyva
/// ett tecken mitt itu.
fn split(value: &str) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut aktuell = String::new();
    let mut units = 0usize;
    for c in value.chars() {
        let bredd = c.len_utf16();
        if units + bredd > MAX_UNITS {
            chunks.push(std::mem::take(&mut aktuell));
            units = 0;
        }
        aktuell.push(c);
        units += bredd;
    }
    if !aktuell.is_empty() || chunks.is_empty() {
        chunks.push(aktuell);
    }
    chunks
}

#[derive(Debug, thiserror::Error, Serialize)]
pub enum StoreError {
    #[error("ogiltig nyckel")]
    InvalidKey,
    #[error("kunde inte nå Windows Credential Manager: {0}")]
    Backend(String),
    #[error("lagrad session är ofullständig")]
    Corrupt,
}

/// Tillåt bara nycklar som klienten själv bildar. Skyddar mot att en
/// manipulerad frontend försöker läsa andra program eller tjänsters poster.
fn validate(key: &str) -> Result<(), StoreError> {
    let ok = !key.is_empty()
        && key.len() <= 190
        && key
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.' | ':'));
    if ok {
        Ok(())
    } else {
        Err(StoreError::InvalidKey)
    }
}

fn entry(key: &str) -> Result<Entry, StoreError> {
    validate(key)?;
    Entry::new(SERVICE, key).map_err(|e| StoreError::Backend(e.to_string()))
}

fn read_raw(key: &str) -> Result<Option<String>, StoreError> {
    match entry(key)?.get_password() {
        Ok(v) => Ok(Some(v)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(StoreError::Backend(e.to_string())),
    }
}

fn write_raw(key: &str, value: &str) -> Result<(), StoreError> {
    entry(key)?
        .set_password(value)
        .map_err(|e| StoreError::Backend(e.to_string()))
}

fn delete_raw(key: &str) -> Result<(), StoreError> {
    match entry(key)?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(StoreError::Backend(e.to_string())),
    }
}

/// Antal delposter enligt huvudposten, om värdet är uppdelat.
fn chunk_count(key: &str) -> Result<Option<usize>, StoreError> {
    let Some(huvud) = read_raw(key)? else {
        return Ok(None);
    };
    match huvud.strip_prefix(CHUNK_PREFIX) {
        None => Ok(None),
        Some(antal) => antal.parse().map(Some).map_err(|_| StoreError::Corrupt),
    }
}

/// Raderar delposterna i intervallet. Letar igenom hela intervallet utan att
/// avbryta vid första lucka – en avbruten skrivning kan ha lämnat glest
/// numrerade poster, och de får inte bli kvar.
fn clear_chunks(key: &str, from: usize, to: usize) -> Result<(), StoreError> {
    for i in from..to.min(MAX_CHUNKS) {
        let k = chunk_key(key, i);
        if read_raw(&k)?.is_some() {
            delete_raw(&k)?;
        }
    }
    Ok(())
}

pub fn get(key: &str) -> Result<Option<String>, StoreError> {
    let Some(huvud) = read_raw(key)? else {
        return Ok(None);
    };
    let Some(antal) = huvud.strip_prefix(CHUNK_PREFIX) else {
        return Ok(Some(huvud));
    };
    let antal: usize = antal.parse().map_err(|_| StoreError::Corrupt)?;

    let mut value = String::new();
    for i in 0..antal {
        let del = read_raw(&chunk_key(key, i))?.ok_or(StoreError::Corrupt)?;
        value.push_str(&del);
    }
    Ok(Some(value))
}

pub fn set(key: &str, value: &str) -> Result<(), StoreError> {
    let tidigare = chunk_count(key)?.unwrap_or(0);
    let chunks = split(value);

    if chunks.len() == 1 {
        write_raw(key, &chunks[0])?;
    } else {
        for (i, del) in chunks.iter().enumerate() {
            write_raw(&chunk_key(key, i), del)?;
        }
        // Rubriken skrivs sist: fram till dess pekar huvudposten på den gamla
        // sessionen, så ett avbrott mitt i mitten lämnar inte en halv session.
        write_raw(key, &format!("{CHUNK_PREFIX}{}", chunks.len()))?;
    }

    // Städa bort delposter från en tidigare, längre session. Ett kort värde
    // ligger i huvudposten, och då ska samtliga gamla delposter bort.
    let forsta_overblivna = if chunks.len() == 1 { 0 } else { chunks.len() };
    clear_chunks(key, forsta_overblivna, tidigare.max(chunks.len()).max(forsta_overblivna + 8))
}

pub fn remove(key: &str) -> Result<(), StoreError> {
    let antal = chunk_count(key)?.unwrap_or(0);
    delete_raw(key)?;
    clear_chunks(key, 0, antal.max(8))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nycklar_valideras() {
        assert!(validate("sb-berryit-auth-token").is_ok());
        assert!(validate("").is_err());
        assert!(validate("../annan-tjanst").is_err());
        assert!(validate("nyckel med mellanslag").is_err());
        assert!(validate(&"a".repeat(191)).is_err());
    }

    #[test]
    fn skriv_las_radera() {
        let key = "berryit-test-token";
        set(key, "hemligt-varde").expect("skriv");
        assert_eq!(get(key).expect("las"), Some("hemligt-varde".to_string()));
        remove(key).expect("radera");
        assert_eq!(get(key).expect("las efter radering"), None);
    }

    #[test]
    fn saknad_nyckel_ger_none() {
        assert_eq!(get("berryit-finns-inte-alls").expect("las"), None);
    }

    #[test]
    fn langt_varde_delas_och_satts_ihop() {
        // En Supabase-session är större än Credential Managers gräns på 2560
        // UTF-16-enheter per post, därför måste den delas upp.
        let key = "berryit-test-lang";
        let varde: String = std::iter::repeat_with(|| "eyJhbGciOiJIUzI1NiJ9.")
            .take(1000)
            .collect::<String>();
        assert!(varde.chars().map(char::len_utf16).sum::<usize>() > MAX_UNITS);

        set(key, &varde).expect("skriv langt varde");
        assert_eq!(get(key).expect("las").as_deref(), Some(varde.as_str()));

        // Ett kortare värde ska inte lämna kvar gamla delposter.
        set(key, "kort").expect("skriv kort varde");
        assert_eq!(get(key).expect("las kort").as_deref(), Some("kort"));
        for i in 0..24 {
            assert_eq!(
                read_raw(&chunk_key(key, i)).expect("delpost"),
                None,
                "delpost {i} blev kvar"
            );
        }

        remove(key).expect("radera");
        assert_eq!(get(key).expect("las efter radering"), None);
    }

    #[test]
    fn glesa_delposter_stadas_bort() {
        // En avbruten skrivning kan lämna delposter med luckor. Städningen får
        // inte sluta vid första lucka.
        let key = "berryit-test-glest";
        set(key, "kort").expect("skriv");
        write_raw(&chunk_key(key, 3), "skrap").expect("skriv skrap");
        write_raw(&chunk_key(key, 7), "skrap").expect("skriv skrap");
        set(key, "kort igen").expect("skriv om");
        assert_eq!(read_raw(&chunk_key(key, 3)).expect("las"), None);
        assert_eq!(read_raw(&chunk_key(key, 7)).expect("las"), None);
        remove(key).expect("radera");
    }

    #[test]
    fn delning_respekterar_gransen() {
        let delar = split(&"a".repeat(MAX_UNITS * 2 + 5));
        assert_eq!(delar.len(), 3);
        for d in &delar {
            assert!(d.chars().map(char::len_utf16).sum::<usize>() <= MAX_UNITS);
        }
        assert_eq!(delar.concat().len(), MAX_UNITS * 2 + 5);
    }

    #[test]
    fn delning_klyver_inte_tecken() {
        // Emoji tar två UTF-16-enheter och får inte delas mitt itu.
        let varde = "😀".repeat(MAX_UNITS);
        let delar = split(&varde);
        assert_eq!(delar.concat(), varde);
        for d in &delar {
            assert!(d.chars().map(char::len_utf16).sum::<usize>() <= MAX_UNITS);
        }
    }
}

