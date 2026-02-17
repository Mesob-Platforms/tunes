//js/ui-interactions.js
import {
    SVG_CLOSE,
    SVG_BIN,
    SVG_HEART,
    SVG_DOWNLOAD,
    formatTime,
    getTrackTitle,
    getTrackArtists,
    escapeHtml,
    createQualityBadgeHTML,
} from './utils.js';
import { sidePanelManager } from './side-panel.js';
import { downloadQualitySettings } from './storage.js';

export function initializeUIInteractions(player, api, ui) {
    const sidebar = document.querySelector('.sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const hamburgerBtn = document.getElementById('hamburger-btn');
    const queueBtn = document.getElementById('queue-btn');
    // Library page drag-and-drop is now handled inside folder sub-views only
    // (the main library uses library-row items, not card-grid drag targets)

    let draggedQueueIndex = null;

    // Sidebar mobile
    hamburgerBtn.addEventListener('click', () => {
        sidebar.classList.add('is-open');
        sidebarOverlay.classList.add('is-visible');
    });

    const closeSidebar = () => {
        sidebar.classList.remove('is-open');
        sidebarOverlay.classList.remove('is-visible');
    };

    sidebarOverlay.addEventListener('click', closeSidebar);

    // Mobile back button - handles both fullscreen and side panel closing
    const mobileBackBtn = document.getElementById('mobile-back-btn');
    if (mobileBackBtn) {
        mobileBackBtn.addEventListener('click', () => {
            // Close side panel if open
            const sidePanel = document.getElementById('side-panel');
            if (sidePanel && sidePanel.classList.contains('active')) {
                sidePanelManager.close();
                return;
            }
            // Close fullscreen if open
            const fullscreenOverlay = document.getElementById('fullscreen-cover-overlay');
            if (fullscreenOverlay && fullscreenOverlay.style.display !== 'none') {
                if (window.location.hash === '#fullscreen') {
                    window.history.back();
                } else {
                    ui.closeFullscreenCover();
                }
                return;
            }
            // Otherwise go back in history
            window.history.back();
        });
    }

    sidebar.addEventListener('click', (e) => {
        if (e.target.closest('a')) {
            closeSidebar();
        }
    });

    // Queue panel
    const renderQueueControls = (container) => {
        const currentQueue = player.getCurrentQueue();
        const showActionBtns = currentQueue.length > 0;

        container.innerHTML = `
            <button id="download-queue-btn" class="btn-icon" title="Download Queue" style="display: ${showActionBtns ? 'flex' : 'none'}">
                ${SVG_DOWNLOAD}
            </button>
            <button id="like-queue-btn" class="btn-icon" title="Add Queue to Liked" style="display: ${showActionBtns ? 'flex' : 'none'}">
                ${SVG_HEART}
            </button>
            <button id="add-queue-to-playlist-btn" class="btn-icon" title="Add Queue to Playlist" style="display: ${showActionBtns ? 'flex' : 'none'}">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                    <rect x="3" y="3" width="18" height="18" rx="3"/>
                    <path d="M12 8v8"/><path d="M8 12h8"/>
                </svg>
            </button>
            <button id="clear-queue-btn" class="btn-icon" title="Clear Queue" style="display: ${showActionBtns ? 'flex' : 'none'}">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
            </button>
            <button id="close-side-panel-btn" class="btn-icon" title="Close">
                ${SVG_CLOSE}
            </button>
        `;

        container.querySelector('#close-side-panel-btn').addEventListener('click', () => {
            sidePanelManager.close();
        });

        const downloadBtn = container.querySelector('#download-queue-btn');
        if (downloadBtn) {
            downloadBtn.addEventListener('click', async () => {
                const { downloadTracks } = await import('./downloads.js');
                downloadTracks(currentQueue, api, downloadQualitySettings.getQuality());
            });
        }

        const likeBtn = container.querySelector('#like-queue-btn');
        if (likeBtn) {
            likeBtn.addEventListener('click', async () => {
                const { db } = await import('./db.js'); // Already imported
                const { syncManager } = await import('./accounts/supabaseSync.js');
                const { showNotification } = await import('./downloads.js');

                let addedCount = 0;
                for (const track of currentQueue) {
                    const wasAdded = await db.toggleFavorite('track', track);
                    if (wasAdded) {
                        syncManager.syncLibraryItem('track', track, true);
                        addedCount++;
                    }
                }

                if (addedCount > 0) {
                    showNotification(`Added ${addedCount} track${addedCount > 1 ? 's' : ''} to Liked`);
                } else {
                    showNotification('All tracks in queue are already liked');
                }

                refreshQueuePanel();
            });
        }

        const addToPlaylistBtn = container.querySelector('#add-queue-to-playlist-btn');
        if (addToPlaylistBtn) {
            addToPlaylistBtn.addEventListener('click', async () => {
                const { db } = await import('./db.js'); // Already imported
                const { syncManager } = await import('./accounts/supabaseSync.js');
                const { showNotification } = await import('./downloads.js');

                const playlists = await db.getPlaylists();
                if (playlists.length === 0) {
                    showNotification('No playlists yet. Create one first.');
                    return;
                }

                const modal = document.createElement('div');
                modal.className = 'modal active';
                modal.innerHTML = `
                    <div class="modal-overlay"></div>
                    <div class="modal-content">
                        <h3>Add Queue to Playlist</h3>
                        <div class="modal-list">
                            ${playlists
                                .map(
                                    (p) => `
                                <div class="modal-option" data-id="${p.id}">${escapeHtml(p.name)}</div>
                            `
                                )
                                .join('')}
                        </div>
                        <div class="modal-actions">
                            <button class="btn-secondary cancel-btn">Cancel</button>
                        </div>
                    </div>
                `;

                document.body.appendChild(modal);

                const closeModal = () => {
                    modal.remove();
                };

                modal.addEventListener('click', async (e) => {
                    if (e.target.classList.contains('modal-overlay') || e.target.classList.contains('cancel-btn')) {
                        closeModal();
                        return;
                    }

                    const option = e.target.closest('.modal-option');
                    if (option) {
                        const playlistId = option.dataset.id;
                        const playlistName = option.textContent;

                        try {
                            let addedCount = 0;
                            for (const track of currentQueue) {
                                await db.addTrackToPlaylist(playlistId, track);
                                addedCount++;
                            }

                            const updatedPlaylist = await db.getPlaylist(playlistId);
                            syncManager.syncUserPlaylist(updatedPlaylist, 'update');

                            showNotification(`Added ${addedCount} tracks to playlist: ${playlistName}`);
                        } catch (error) {
                            console.error('Failed to add tracks to playlist:', error);
                            showNotification('Failed to add tracks to playlist');
                        }

                        closeModal();
                    }
                });
            });
        }

        const clearBtn = container.querySelector('#clear-queue-btn');
        if (clearBtn) {
            clearBtn.addEventListener('click', () => {
                player.clearQueue();
                refreshQueuePanel();
            });
        }
    };

    const renderQueueContent = (container) => {
        const currentQueue = player.getCurrentQueue();

        if (currentQueue.length === 0) {
            container.innerHTML = '<div class="placeholder-text">Queue is empty.</div>';
            return;
        }

        const html = currentQueue
            .map((track, index) => {
                const isPlaying = index === player.currentQueueIndex;
                const trackTitle = getTrackTitle(track);
                const trackArtists = getTrackArtists(track, { fallback: 'Unknown' });
                const qualityBadge = createQualityBadgeHTML(track);

                return `
                <div class="queue-track-item ${isPlaying ? 'playing' : ''}" data-queue-index="${index}" data-track-id="${track.id}" draggable="true">
                    <div class="drag-handle">
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                            <line x1="5" y1="8" x2="19" y2="8"></line>
                            <line x1="5" y1="16" x2="19" y2="16"></line>
                        </svg>
                    </div>
                    <div class="track-item-info">
                        <img src="${api.getCoverUrl(track.album?.cover)}"
                             class="track-item-cover" loading="lazy">
                        <div class="track-item-details">
                            <div class="title">${escapeHtml(trackTitle)} ${qualityBadge}</div>
                            <div class="artist">${escapeHtml(trackArtists)}</div>
                        </div>
                    </div>
                    <div class="track-item-duration">${formatTime(track.duration)}</div>
                    <button class="queue-like-btn" data-action="toggle-like" title="Add to Liked">
                        ${SVG_HEART}
                    </button>
                    <button class="queue-remove-btn" data-track-index="${index}" title="Remove from queue">
                        ${SVG_BIN}
                    </button>
                </div>
            `;
            })
            .join('');

        container.innerHTML = html;

        container.querySelectorAll('.queue-track-item').forEach(async (item) => {
            const index = parseInt(item.dataset.queueIndex);
            const track = player.getCurrentQueue()[index];

            // Update like button state
            const likeBtn = item.querySelector('.queue-like-btn');
            if (likeBtn && track) {
                const { db } = await import('./db.js');
                const isLiked = await db.isFavorite('track', track.id);
                likeBtn.classList.toggle('active', isLiked);
                likeBtn.innerHTML = isLiked
                    ? SVG_HEART.replace('class="heart-icon"', 'class="heart-icon filled"')
                    : SVG_HEART;
            }

            item.addEventListener('click', async (e) => {
                const removeBtn = e.target.closest('.queue-remove-btn');
                if (removeBtn) {
                    e.stopPropagation();
                    player.removeFromQueue(index);
                    refreshQueuePanel();
                    return;
                }

                const likeBtn = e.target.closest('.queue-like-btn');
                if (likeBtn && likeBtn.dataset.action === 'toggle-like') {
                    e.stopPropagation();
                    const track = player.getCurrentQueue()[index];
                    if (track) {
                        const { db } = await import('./db.js'); // Already imported
                        const { syncManager } = await import('./accounts/supabaseSync.js');
                        const { showNotification } = await import('./downloads.js');

                        const added = await db.toggleFavorite('track', track);
                        syncManager.syncLibraryItem('track', track, added);

                        // Update button state
                        likeBtn.classList.toggle('active', added);
                        likeBtn.innerHTML = added
                            ? SVG_HEART.replace('class="heart-icon"', 'class="heart-icon filled"')
                            : SVG_HEART;

                        showNotification(
                            added ? `Added to Liked: ${track.title}` : `Removed from Liked: ${track.title}`
                        );
                    }
                    return;
                }

                player.playAtIndex(index);
                refreshQueuePanel();
            });

            item.addEventListener('contextmenu', async (e) => {
                e.preventDefault();
                const contextMenu = document.getElementById('context-menu');
                if (contextMenu) {
                    const track = player.getCurrentQueue()[index];
                    if (track) {
                        const { db } = await import('./db.js');
                        const isLiked = await db.isFavorite('track', track.id);
                        const likeItem = contextMenu.querySelector('li[data-action="toggle-like"]');
                        if (likeItem) {
                            likeItem.textContent = isLiked ? 'Unlike' : 'Like';
                        }

                        const trackMixItem = contextMenu.querySelector('li[data-action="track-mix"]');
                        if (trackMixItem) {
                            const hasMix = track.mixes && track.mixes.TRACK_MIX;
                            trackMixItem.style.display = hasMix ? 'block' : 'none';
                        }

                        const menuWidth = 150;
                        const menuHeight = 200;

                        let left = e.clientX;
                        let top = e.clientY;

                        if (left + menuWidth > window.innerWidth) {
                            left = window.innerWidth - menuWidth - 10;
                        }
                        if (top + menuHeight > window.innerHeight) {
                            top = e.clientY - menuHeight - 10;
                        }

                        contextMenu.style.left = `${left}px`;
                        contextMenu.style.top = `${top}px`;
                        contextMenu.style.display = 'block';

                        contextMenu._contextTrack = track;
                    }
                }
            });

            item.addEventListener('dragstart', () => {
                draggedQueueIndex = index;
                item.style.opacity = '0.5';
            });

            item.addEventListener('dragend', () => {
                item.style.opacity = '1';
            });

            item.addEventListener('dragover', (e) => {
                e.preventDefault();
            });

            item.addEventListener('drop', (e) => {
                e.preventDefault();
                if (draggedQueueIndex !== null && draggedQueueIndex !== index) {
                    player.moveInQueue(draggedQueueIndex, index);
                    refreshQueuePanel();
                }
            });
        });
    };

    const refreshQueuePanel = () => {
        sidePanelManager.refresh('queue', renderQueueControls, renderQueueContent);
    };

    const openQueuePanel = () => {
        sidePanelManager.open('queue', 'Queue', renderQueueControls, renderQueueContent);
    };

    queueBtn.addEventListener('click', openQueuePanel);

    // Expose renderQueue for external updates (e.g. shuffle, add to queue)
    window.renderQueueFunction = () => {
        if (sidePanelManager.isActive('queue')) {
            refreshQueuePanel();
        }

        const overlay = document.getElementById('fullscreen-cover-overlay');
        if (overlay && getComputedStyle(overlay).display !== 'none') {
            ui.updateFullscreenMetadata(player.currentTrack, player.getNextTrack());
        }
    };

    const folderPage = document.getElementById('page-folder');
    if (folderPage) {
        folderPage.addEventListener('dragover', (e) => {
            if (e.dataTransfer.types.includes('text/playlist-id')) {
                e.preventDefault();
                folderPage.classList.add('drag-over-folder-page');
            }
        });
        folderPage.addEventListener('dragleave', () => {
            folderPage.classList.remove('drag-over-folder-page');
        });
        folderPage.addEventListener('drop', async (e) => {
            e.preventDefault();
            folderPage.classList.remove('drag-over-folder-page');
            const playlistId = e.dataTransfer.getData('text/playlist-id');
            const folderId = window.location.pathname.split('/')[2];
            if (playlistId && folderId) {
                const { db } = await import('./db.js');
                const { syncManager } = await import('./accounts/supabaseSync.js');
                const { showNotification } = await import('./downloads.js');
                try {
                    const updatedFolder = await db.addPlaylistToFolder(folderId, playlistId);
                    syncManager.syncUserFolder(updatedFolder, 'update');
                    window.dispatchEvent(new HashChangeEvent('hashchange'));
                    showNotification('Playlist added to folder');
                } catch (error) {
                    console.error('Failed to add playlist to folder:', error);
                    showNotification('Failed to add playlist to folder', 'error');
                }
            }
        });
    }

    // Search tabs (library no longer uses these – it has its own toolbar)
    document.querySelectorAll('.search-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            const page = tab.closest('.page');
            if (!page) return;

            page.querySelectorAll('.search-tab').forEach((t) => t.classList.remove('active'));
            page.querySelectorAll('.search-tab-content').forEach((c) => c.classList.remove('active'));

            tab.classList.add('active');

            const contentId = `search-tab-${tab.dataset.tab}`;
            const contentEl = document.getElementById(contentId);
            contentEl?.classList.add('active');

        });
    });

    // Settings tabs
    document.querySelectorAll('.settings-tab').forEach((tab) => {
        tab.addEventListener('click', () => {
            document.querySelectorAll('.settings-tab').forEach((t) => t.classList.remove('active'));
            document.querySelectorAll('.settings-tab-content').forEach((c) => c.classList.remove('active'));

            tab.classList.add('active');

            const contentId = `settings-tab-${tab.dataset.tab}`;
            document.getElementById(contentId)?.classList.add('active');
        });
    });

    // Three-dot more menu toggle for detail pages, player bar, and fullscreen
    document.addEventListener('click', (e) => {
        const moreBtn = e.target.closest('.detail-more-btn');
        if (moreBtn) {
            e.stopPropagation();
            const wrapper = moreBtn.closest('.detail-more-wrapper');
            const dropdown = wrapper.querySelector('.detail-more-dropdown');

            // Close all other open dropdowns first
            document.querySelectorAll('.detail-more-dropdown.open').forEach((d) => {
                if (d !== dropdown) d.classList.remove('open');
            });

            dropdown.classList.toggle('open');
            return;
        }

        // Close dropdown when clicking an item inside it
        const dropdownItem = e.target.closest('.detail-more-dropdown button');
        if (dropdownItem) {
            const dropdown = dropdownItem.closest('.detail-more-dropdown');
            if (dropdown) dropdown.classList.remove('open');
        }

        // Close all open dropdowns when clicking outside
        document.querySelectorAll('.detail-more-dropdown.open').forEach((d) => {
            d.classList.remove('open');
        });
    });

    // Tooltip for truncated text
    let tooltipEl = document.getElementById('custom-tooltip');
    if (!tooltipEl) {
        tooltipEl = document.createElement('div');
        tooltipEl.id = 'custom-tooltip';
        document.body.appendChild(tooltipEl);
    }

    const updateTooltipPosition = (e) => {
        const x = e.clientX + 15;
        const y = e.clientY + 15;

        // Prevent going off-screen
        const rect = tooltipEl.getBoundingClientRect();
        const winWidth = window.innerWidth;
        const winHeight = window.innerHeight;

        let finalX = x;
        let finalY = y;

        if (x + rect.width > winWidth) {
            finalX = e.clientX - rect.width - 10;
        }

        if (y + rect.height > winHeight) {
            finalY = e.clientY - rect.height - 10;
        }

        tooltipEl.style.transform = `translate(${finalX}px, ${finalY}px)`;
        // Reset top/left to 0 since we use transform
        tooltipEl.style.top = '0';
        tooltipEl.style.left = '0';
    };

    document.body.addEventListener('mouseover', (e) => {
        const selector =
            '.card-title, .card-subtitle, .track-item-details .title, .track-item-details .artist, .now-playing-bar .title, .now-playing-bar .artist, .now-playing-bar .album';
        const target = e.target.closest(selector);

        if (target) {
            // Remove native title if present to avoid double tooltip
            if (target.hasAttribute('title')) {
                target.removeAttribute('title');
            }

            if (target.scrollWidth > target.clientWidth) {
                tooltipEl.innerHTML = target.innerHTML.trim();
                tooltipEl.classList.add('visible');
                updateTooltipPosition(e);

                const moveHandler = (moveEvent) => {
                    updateTooltipPosition(moveEvent);
                };

                const outHandler = () => {
                    tooltipEl.classList.remove('visible');
                    target.removeEventListener('mousemove', moveHandler);
                    target.removeEventListener('mouseleave', outHandler);
                };

                target.addEventListener('mousemove', moveHandler);
                target.addEventListener('mouseleave', outHandler);
            }
        }
    });
}
