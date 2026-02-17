//js/settings
import { sidebarSectionSettings, streamingQualitySettings } from './storage.js';

export function initializeSettings(scrobbler, player, api, ui) {
    // Set streaming quality from saved preference (defaults to LOW)
    player.setQuality(streamingQualitySettings.getQuality());

    // Apply sidebar visibility (hardcoded: hide settings, account, download, discord)
    sidebarSectionSettings.applySidebarVisibility();
}
