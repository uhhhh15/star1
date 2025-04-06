// public/extensions/third-party/favorites-plugin/index_new.js

// Import from the core script
import {
    // saveSettingsDebounced, // 不再需要从这里导入，因为是针对全局设置的
    eventSource,
    event_types,
    messageFormatting,
} from '../../../../script.js';

// Import from the extension helper script
import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
    saveMetadataDebounced // <-- 确认从这里导入正确的函数
} from '../../../extensions.js';

// Import from the Popup utility script
import {
    Popup,
    POPUP_TYPE,
    callGenericPopup,
    POPUP_RESULT,
} from '../../../popup.js';

// Import from the general utility script
import {
    uuidv4,
    // timestampToMoment, // 暂时未使用，保留 import
} from '../../../utils.js';

// Define plugin folder name (important for consistency)
const pluginName = 'starZ'; // 统一使用这个名称

// Initialize plugin settings if they don't exist (这部分保持不变，用于插件自身设置，非收藏数据)
if (!extension_settings[pluginName]) {
    extension_settings[pluginName] = {};
}

// Define HTML for the favorite toggle icon
const messageButtonHtml = `
    <div class="mes_button favorite-toggle-icon" title="收藏/取消收藏">
        <i class="fa-regular fa-star"></i>
    </div>
`;

// Store reference to the favorites popup
let favoritesPopup = null;
// Current pagination state
let currentPage = 1;
const itemsPerPage = 5;

/**
 * Ensures the favorites array exists in the current chat metadata accessed via getContext()
 * @returns {object | null} The chat metadata object if available and favorites array is ensured, null otherwise.
 */
function ensureFavoritesArrayExists() {
    let context;
    try {
        context = getContext();
        // 检查 context 和 context.chatMetadata 是否有效
        if (!context || !context.chatMetadata) {
            console.error(`${pluginName}: ensureFavoritesArrayExists - context or context.chatMetadata is not available!`);
            return null; // 返回 null 表示失败
        }
    } catch (e) {
        console.error(`${pluginName}: ensureFavoritesArrayExists - Error calling getContext():`, e);
        return null; // 返回 null 表示失败
    }

    // 使用 context 返回的元数据对象
    const chatMetadata = context.chatMetadata;

    // 检查 favorites 属性是否为数组，如果不是或不存在，则初始化为空数组
    if (!Array.isArray(chatMetadata.favorites)) {
        console.log(`${pluginName}: Initializing chatMetadata.favorites array.`);
        chatMetadata.favorites = [];
        // 注意：初始化后，chatMetadata 对象本身被修改了，后续保存时会保存这个修改
    }
    return chatMetadata; // 返回有效的元数据对象
}


/**
 * Adds a favorite item to the current chat metadata
 * @param {Object} messageInfo Information about the message being favorited
 */
function addFavorite(messageInfo) {
    console.log(`${pluginName}: addFavorite 函数开始执行，接收到的 messageInfo:`, messageInfo);

    const chatMetadata = ensureFavoritesArrayExists(); // 获取元数据对象
    if (!chatMetadata) { // 检查是否获取成功
         console.error(`${pluginName}: addFavorite - 获取 chatMetadata 失败，退出`);
         return;
    }

    // 创建收藏项 (已移除 timestamp)
    const item = {
        id: uuidv4(),
        messageId: messageInfo.messageId, // 存储的是 mesid 字符串
        sender: messageInfo.sender,
        role: messageInfo.role,
        note: ''
    };

    // 确保 favorites 是数组 (理论上 ensureFavoritesArrayExists 已保证，但多一层防护)
    if (!Array.isArray(chatMetadata.favorites)) {
        console.error(`${pluginName}: addFavorite - chatMetadata.favorites 不是数组，无法添加！`);
        return;
    }

    console.log(`${pluginName}: 添加前 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));
    chatMetadata.favorites.push(item); // 修改获取到的元数据对象的 favorites 数组
    console.log(`${pluginName}: 添加后 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));

    console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存更改...`);
    saveMetadataDebounced(); // 调用导入的保存函数

    console.log(`${pluginName}: Added favorite:`, item);

    // Update the popup if it's open and the underlying dialog is open
    if (favoritesPopup && favoritesPopup.dlg && favoritesPopup.dlg.open) {
        updateFavoritesPopup();
    }
}

/**
 * Removes a favorite by its ID
 * @param {string} favoriteId The ID of the favorite to remove
 * @returns {boolean} True if successful, false otherwise
 */
function removeFavoriteById(favoriteId) {
    console.log(`${pluginName}: removeFavoriteById - 尝试删除 ID: ${favoriteId}`);
    const chatMetadata = ensureFavoritesArrayExists();
    // 检查 chatMetadata 和 favorites 数组是否有效且不为空
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
        console.warn(`${pluginName}: removeFavoriteById - chatMetadata 无效或 favorites 数组为空`);
        return false;
    }

    const indexToRemove = chatMetadata.favorites.findIndex(fav => fav.id === favoriteId);
    if (indexToRemove !== -1) {
        console.log(`${pluginName}: 删除前 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));
        chatMetadata.favorites.splice(indexToRemove, 1);
        console.log(`${pluginName}: 删除后 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));

        console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存删除...`);
        saveMetadataDebounced(); // 调用导入的保存函数
        console.log(`${pluginName}: Favorite removed: ${favoriteId}`);
        return true;
    }

    console.warn(`${pluginName}: Favorite with id ${favoriteId} not found.`);
    return false;
}

/**
 * Removes a favorite by the message ID it references
 * @param {string} messageId The message ID (from mesid attribute)
 * @returns {boolean} True if successful, false otherwise
 */
function removeFavoriteByMessageId(messageId) {
    console.log(`${pluginName}: removeFavoriteByMessageId - 尝试删除 messageId: ${messageId}`);
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
         console.warn(`${pluginName}: removeFavoriteByMessageId - chatMetadata 无效或 favorites 数组为空`);
         return false;
    }

    // 根据 messageId 查找收藏项
    const favItem = chatMetadata.favorites.find(fav => fav.messageId === messageId);
    if (favItem) {
        // 如果找到，调用按 favoriteId 删除的函数
        return removeFavoriteById(favItem.id);
    }

    console.warn(`${pluginName}: Favorite for messageId ${messageId} not found.`);
    return false;
}

/**
 * Updates the note for a favorite item
 * @param {string} favoriteId The ID of the favorite
 * @param {string} note The new note text
 */
function updateFavoriteNote(favoriteId, note) {
    console.log(`${pluginName}: updateFavoriteNote - 尝试更新 ID: ${favoriteId} 的备注`);
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
         console.warn(`${pluginName}: updateFavoriteNote - chatMetadata 无效或 favorites 数组为空`);
         return;
    }

    const favorite = chatMetadata.favorites.find(fav => fav.id === favoriteId);
    if (favorite) {
        favorite.note = note;
        console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存备注更新...`);
        saveMetadataDebounced(); // 调用导入的保存函数
        console.log(`${pluginName}: Updated note for favorite ${favoriteId}`);
    } else {
        console.warn(`${pluginName}: updateFavoriteNote - Favorite with id ${favoriteId} not found.`);
    }
}

/**
 * Handles the toggle of favorite status when clicking the star icon
 * @param {Event} event The click event
 */
function handleFavoriteToggle(event) {
    console.log(`${pluginName}: handleFavoriteToggle - 开始执行`);

    const target = $(event.target).closest('.favorite-toggle-icon');
    if (!target.length) {
        console.log(`${pluginName}: handleFavoriteToggle - 退出：未找到 .favorite-toggle-icon`);
        return;
    }

    const messageElement = target.closest('.mes');
    if (!messageElement || !messageElement.length) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：无法找到父级 .mes 元素`);
        return;
    }

    const messageIdString = messageElement.attr('mesid');
    if (!messageIdString) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：未找到 mesid 属性`);
        return;
    }

    // messageIdString is the primary identifier, usually a string that looks like a number
    console.log(`${pluginName}: handleFavoriteToggle - 获取 context 和消息对象 (mesid: ${messageIdString})`);
    let context;
    try {
        context = getContext();
        if (!context || !context.chat) {
            console.error(`${pluginName}: handleFavoriteToggle - 退出：getContext() 返回无效或缺少 chat 属性`);
            return;
        }
    } catch (e) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：调用 getContext() 时出错:`, e);
        return;
    }

    // Find message primarily by mesid attribute string
    const message = context.chat.find(msg => String($(msg).attr?.('mesid')) === messageIdString);

    if (!message) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：在 chat 中未找到 mesid 为 ${messageIdString} 的消息对象`);
        return;
    }

    console.log(`${pluginName}: handleFavoriteToggle - 成功获取消息对象:`, message);

    const iconElement = target.find('i');
    if (!iconElement || !iconElement.length) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：在 .favorite-toggle-icon 内未找到 i 元素`);
        return;
    }
    const isCurrentlyFavorited = iconElement.hasClass('fa-solid');

    console.log(`${pluginName}: handleFavoriteToggle - 更新 UI，当前状态 (isFavorited): ${isCurrentlyFavorited}`);
    if (isCurrentlyFavorited) {
        iconElement.removeClass('fa-solid').addClass('fa-regular');
        console.log(`${pluginName}: handleFavoriteToggle - UI 更新为：取消收藏 (regular icon)`);
    } else {
        iconElement.removeClass('fa-regular').addClass('fa-solid');
        console.log(`${pluginName}: handleFavoriteToggle - UI 更新为：收藏 (solid icon)`);
    }

    if (!isCurrentlyFavorited) {
        console.log(`${pluginName}: handleFavoriteToggle - 准备调用 addFavorite`);
        const messageInfo = {
            messageId: messageIdString, // Use the original mesid string
            sender: message.name,
            role: message.is_user ? 'user' : 'character', // Determine role based on message property
        };
        console.log(`${pluginName}: handleFavoriteToggle - addFavorite 参数:`, messageInfo);
        try {
            addFavorite(messageInfo);
            console.log(`${pluginName}: handleFavoriteToggle - addFavorite 调用完成`);
        } catch (e) {
             console.error(`${pluginName}: handleFavoriteToggle - 调用 addFavorite 时出错:`, e);
        }
    } else {
        console.log(`${pluginName}: handleFavoriteToggle - 准备调用 removeFavoriteByMessageId`);
        console.log(`${pluginName}: handleFavoriteToggle - removeFavoriteByMessageId 参数: ${messageIdString}`);
        try {
            removeFavoriteByMessageId(messageIdString);
            console.log(`${pluginName}: handleFavoriteToggle - removeFavoriteByMessageId 调用完成`);
        } catch (e) {
             console.error(`${pluginName}: handleFavoriteToggle - 调用 removeFavoriteByMessageId 时出错:`, e);
        }
    }

    console.log(`${pluginName}: handleFavoriteToggle - 执行完毕`);
}

/**
 * Adds favorite toggle icons to all messages in the chat that don't have one
 */
function addFavoriteIconsToMessages() {
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        // Find the designated container for extra buttons
        const extraButtonsContainer = messageElement.find('.extraMesButtons');
        if (extraButtonsContainer.length && !extraButtonsContainer.find('.favorite-toggle-icon').length) {
            extraButtonsContainer.append(messageButtonHtml);
        } else if (!extraButtonsContainer.length) {
            // Fallback or alternative placement if .extraMesButtons doesn't exist
            // Maybe append directly to .mes_buttons? Requires checking ST structure
            // console.warn(`${pluginName}: Could not find .extraMesButtons for message ${messageElement.attr('mesid')}`);
        }
    });
}

/**
 * Updates all favorite icons in the current view to reflect current state
 */
function refreshFavoriteIconsInView() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites)) {
        console.warn(`${pluginName}: refreshFavoriteIconsInView - Cannot get valid chatMetadata or favorites array. Setting all icons to default.`);
        // Ensure all icons are in the default (not favorited) state
        $('#chat').find('.favorite-toggle-icon i').removeClass('fa-solid').addClass('fa-regular');
        return;
    }

    // Make sure all messages have the icon structure first
    addFavoriteIconsToMessages();

    // Create a set of favorited message IDs for efficient lookup
    const favoritedMessageIds = new Set(chatMetadata.favorites.map(fav => fav.messageId));

    // Update icon state based on whether the messageId is in the set
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const messageId = messageElement.attr('mesid'); // Get mesid string

        if (messageId) {
            const isFavorited = favoritedMessageIds.has(messageId);
            const iconElement = messageElement.find('.favorite-toggle-icon i');

            if (iconElement.length) {
                if (isFavorited) {
                    iconElement.removeClass('fa-regular').addClass('fa-solid');
                } else {
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                }
            }
        }
    });
}

/**
 * Renders a single favorite item for the popup
 * @param {Object} favItem The favorite item to render
 * @param {number} index Index of the item (used for pagination)
 * @returns {string} HTML string for the favorite item
 */
function renderFavoriteItem(favItem, index) {
    // Uses favItem.messageId (mesid string) to find the message
    if (!favItem) return '';

    const context = getContext();
    let message = null;
    if (context.chat && Array.isArray(context.chat)) {
         // Find message where mesid attribute matches favItem.messageId
         message = context.chat.find(msg => String($(msg).attr?.('mesid')) === String(favItem.messageId));
         // Fallback: Try finding by index if messageId happens to be index (less common)
         if (!message) {
             const messageIndex = parseInt(favItem.messageId, 10);
             if (!isNaN(messageIndex) && context.chat[messageIndex]) {
                 message = context.chat[messageIndex];
             }
         }
         // Final fallback: Try finding by msg.id property (if it exists)
         if (!message) {
             message = context.chat.find(msg => String(msg.id) === String(favItem.messageId));
         }
    }

    let previewText = '';
    let deletedClass = '';

    if (message && typeof message.mes === 'string') { // Check message.mes exists and is a string
        // Use messageFormatting for a text preview (potentially truncated)
        try {
             // Get the full message text first
             let fullText = message.mes;
             // Manually truncate for the summary preview in the list, keeping original formatting logic goal
             if (fullText.length > 100) { // Truncation limit for preview
                 fullText = fullText.substring(0, 100) + '...';
             }
             // Format the (potentially truncated) text
             previewText = messageFormatting(fullText, favItem.sender, false, // false for isStream
                                            favItem.role === 'user', null, {}, false); // false for parseTextarea
        } catch (e) {
             console.error(`${pluginName}: Error formatting message preview for ${favItem.messageId}:`, e);
             // Fallback to truncated plain text if formatting fails
             previewText = message.mes.substring(0, 100) + (message.mes.length > 100 ? '...' : '');
             previewText = $('<div>').text(previewText).html(); // Basic HTML escaping for safety
        }
    } else {
        previewText = '[消息内容不可用或已删除]'; // Clearer indication
        deletedClass = 'deleted';
    }

    // Return HTML structure including the new preview button
    return `
        <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}" data-index="${index}">
            <div class="fav-meta">${favItem.sender} (${favItem.role})</div>
            <div class="fav-note" style="${favItem.note ? '' : 'display:none;'}">备注：${favItem.note || ''}</div>
            {/* This div shows the formatted, truncated preview */}
            <div class="fav-preview ${deletedClass}">${previewText}</div>
            <div class="fav-actions">
                <i class="fa-solid fa-eye preview-fav" title="预览上下文"></i> {/* Preview button */}
                <i class="fa-solid fa-pencil" title="编辑备注"></i>
                <i class="fa-solid fa-trash" title="删除收藏"></i>
            </div>
        </div>
    `;
}

/**
 * Updates the favorites popup with current data
 */
function updateFavoritesPopup() {
    const chatMetadata = ensureFavoritesArrayExists();
    // Ensure popup exists and its content container is accessible
    if (!favoritesPopup || !favoritesPopup.content || !chatMetadata) {
        console.error(`${pluginName}: updateFavoritesPopup - Popup not ready, content container missing, or chatMetadata missing.`);
        return;
    }
    console.log(`${pluginName}: updateFavoritesPopup - favoritesPopup.content element:`, favoritesPopup.content);


    const context = getContext();
    // Safely access context properties
    const characterName = context?.name2;
    const groupName = context?.groups?.find(g => g.id === context.groupId)?.name || '未命名群组';
    const chatName = context?.characterId ? characterName : `群组: ${groupName}`;
    const totalFavorites = chatMetadata.favorites ? chatMetadata.favorites.length : 0;

    // Sort favorites by messageId (assuming they are numeric strings) in descending order
    const sortedFavorites = chatMetadata.favorites ? [...chatMetadata.favorites].sort((a, b) => {
        const idA = parseInt(a.messageId, 10);
        const idB = parseInt(b.messageId, 10);
        // Handle potential NaN values if messageId is not purely numeric
        if (isNaN(idA) && isNaN(idB)) return 0;
        if (isNaN(idA)) return 1; // Put non-numeric IDs last
        if (isNaN(idB)) return -1;
        return idB - idA; // Descending numeric sort
    }) : [];

    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
    // Ensure currentPage is within valid bounds
    currentPage = Math.max(1, Math.min(currentPage, totalPages));

    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalFavorites);
    const currentPageItems = sortedFavorites.slice(startIndex, endIndex);

    let contentHtml = `
        <div id="favorites-popup-content"> {/* Use an ID for potential specific styling */}
            <div class="favorites-header">
                <h3>${$('<div>').text(chatName).html()} - ${totalFavorites} 条收藏</h3> {/* Basic HTML escaping for name */}
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-list">
    `;

    if (totalFavorites === 0) {
        contentHtml += `<div class="favorites-empty">当前没有收藏的消息。点击消息右下角的星形图标来添加收藏。</div>`;
    } else {
        currentPageItems.forEach((favItem, index) => {
            contentHtml += renderFavoriteItem(favItem, startIndex + index); // Render each item
        });

        // Add pagination controls if more than one page
        if (totalPages > 1) {
            contentHtml += `<div class="favorites-pagination">`;
            contentHtml += `<button class="menu_button pagination-prev" ${currentPage === 1 ? 'disabled' : ''}>上一页</button>`;
            contentHtml += `<span>${currentPage} / ${totalPages}</span>`;
            contentHtml += `<button class="menu_button pagination-next" ${currentPage === totalPages ? 'disabled' : ''}>下一页</button>`;
            contentHtml += `</div>`;
        }
    }

    contentHtml += `
            </div>
            <div class="favorites-footer">
                <button class="menu_button clear-invalid">清理无效收藏</button>
                <button class="menu_button close-popup">关闭</button>
            </div>
        </div>
    `;

    // Update the popup's content container's innerHTML
    try {
        favoritesPopup.content.innerHTML = contentHtml;
        console.log(`${pluginName}: Popup content updated using innerHTML.`);
    } catch (error) {
         console.error(`${pluginName}: Error setting popup innerHTML:`, error);
    }
}

/**
 * Opens or updates the favorites popup
 */
function showFavoritesPopup() {
    if (!favoritesPopup) {
        // Create a new popup if it doesn't exist
        try {
            favoritesPopup = new Popup(
                '<div class="spinner"></div>', // Initial placeholder content
                POPUP_TYPE.DISPLAY, // Use DISPLAY type initially, as we manage content/buttons manually
                '', // No initial input value
                {
                    title: '收藏管理', // Set title via options if Popup supports it, otherwise manage manually
                    wide: true, // Use wide layout
                    okButton: false, // Hide default OK button
                    cancelButton: false, // Hide default Cancel button
                    allowVerticalScrolling: true, // Allow vertical scroll within the content
                    // Note: POPUP_TYPE.DISPLAY might show a close 'X' button by default.
                    // We add our own 'Close' button in the footer.
                    // If POPUP_TYPE.TEXT is used, ensure ok/cancel are explicitly false.
                }
            );

            console.log(`${pluginName}: New Popup instance created successfully.`);

            // Attach event listener to the popup's content container for delegated events
            $(favoritesPopup.content).on('click', function(event) {
                const target = $(event.target);
                const favItemElement = target.closest('.favorite-item'); // Find parent item if click was inside

                // Handle pagination buttons
                if (target.hasClass('pagination-prev')) {
                    if (currentPage > 1) {
                        currentPage--;
                        updateFavoritesPopup();
                    }
                } else if (target.hasClass('pagination-next')) {
                    const chatMetadata = ensureFavoritesArrayExists();
                    const totalFavorites = chatMetadata ? chatMetadata.favorites.length : 0;
                    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
                    if (currentPage < totalPages) {
                        currentPage++;
                        updateFavoritesPopup();
                    }
                }
                // Handle custom close button in the footer
                else if (target.hasClass('close-popup')) {
                    // Use the Popup's internal method if available, otherwise hide dlg directly
                    if (typeof favoritesPopup.completeCancelled === 'function') {
                        favoritesPopup.completeCancelled(); // Preferred way to close cleanly
                    } else {
                        favoritesPopup.dlg.close(); // Fallback
                    }
                }
                // Handle clear invalid button
                else if (target.hasClass('clear-invalid')) {
                    handleClearInvalidFavorites();
                }
                // Handle actions on favorite items (edit, delete, preview)
                else if (favItemElement && favItemElement.length) {
                    const favId = favItemElement.data('fav-id');
                    const msgId = favItemElement.data('msg-id');

                    // Handle edit note (pencil icon)
                    if (target.hasClass('fa-pencil')) {
                        handleEditNote(favId);
                    }
                    // Handle delete favorite (trash icon)
                    else if (target.hasClass('fa-trash')) {
                        handleDeleteFavoriteFromPopup(favId, msgId);
                    }
                    // Handle preview context (eye icon)
                    else if (target.hasClass('preview-fav')) {
                        console.log(`${pluginName}: Preview context requested for msgId: ${msgId}`);
                        handlePreviewFavoriteContext(msgId);
                    }
                }
                 else {
                    // Log clicks not handled if needed for debugging
                    // console.log(`${pluginName}: Unhandled click inside popup content on:`, target);
                }
            });

        } catch (error) {
            console.error(`${pluginName}: Failed during popup creation or event listener setup:`, error);
            favoritesPopup = null; // Reset on failure
            callGenericPopup('创建收藏夹弹窗时出错。', POPUP_TYPE.ERROR); // Inform user
            return;
        }
    } else {
         console.log(`${pluginName}: Reusing existing popup instance.`);
    }

    // Reset to page 1 and update content every time it's shown
    currentPage = 1;
    updateFavoritesPopup();

    // *** CORRECTED VISIBILITY CHECK ***
    // Check if the popup instance exists and its underlying dialog element is NOT open
    if (favoritesPopup && favoritesPopup.dlg && !favoritesPopup.dlg.open) {
        try {
            // Use the show method of the Popup instance
            favoritesPopup.show().catch(err => {
                // Catch potential errors from the show promise itself (e.g., if closed unexpectedly)
                console.error(`${pluginName}: Error occurred after showing popup:`, err);
            });
        } catch(showError) {
             console.error(`${pluginName}: Error calling favoritesPopup.show():`, showError);
             // Optionally reset popup if show fails critically
             favoritesPopup = null;
             callGenericPopup('显示收藏夹弹窗时出错。', POPUP_TYPE.ERROR);
        }
    } else if (favoritesPopup && favoritesPopup.dlg && favoritesPopup.dlg.open) {
        // If already open, maybe bring to front or just log
        console.log(`${pluginName}: Popup is already open.`);
        // Optionally try to focus it:
        favoritesPopup.dlg.focus();
    }
}


/**
 * Opens a new tab to preview the favorited message and its context.
 * @param {string} targetMessageId The message ID (mesid string) of the favorited message.
 */
async function handlePreviewFavoriteContext(targetMessageId) {
    console.log(`${pluginName}: handlePreviewFavoriteContext - Starting for msgId: ${targetMessageId}`);
    let context;
    try {
        context = getContext();
        if (!context || !context.chat || !Array.isArray(context.chat)) {
            console.error(`${pluginName}: handlePreviewFavoriteContext - Invalid context or chat data.`);
            await callGenericPopup('无法获取聊天数据以进行预览。', POPUP_TYPE.ERROR);
            return;
        }
    } catch (e) {
        console.error(`${pluginName}: handlePreviewFavoriteContext - Error getting context:`, e);
        await callGenericPopup('获取聊天上下文时出错。', POPUP_TYPE.ERROR);
        return;
    }

    // Find the index of the target message using its mesid string attribute
    const targetIndex = context.chat.findIndex(msg => String($(msg).attr?.('mesid')) === targetMessageId);

    if (targetIndex === -1) {
        console.error(`${pluginName}: handlePreviewFavoriteContext - Message with mesid ${targetMessageId} not found in chat array.`);
        await callGenericPopup(`在当前聊天中未找到原始消息 (ID: ${targetMessageId})。`, POPUP_TYPE.WARNING);
        return;
    }

    console.log(`${pluginName}: handlePreviewFavoriteContext - Found target message at index: ${targetIndex}`);

    // Gather messages: previous, target, next
    const messagesToPreview = [];
    if (targetIndex > 0) {
        messagesToPreview.push(context.chat[targetIndex - 1]);
    } else {
        messagesToPreview.push(null); // Use null as placeholder if no previous message
    }
    messagesToPreview.push(context.chat[targetIndex]); // The target message
    if (targetIndex < context.chat.length - 1) {
        messagesToPreview.push(context.chat[targetIndex + 1]);
    } else {
        messagesToPreview.push(null); // Use null as placeholder if no next message
    }

    // Filter out the null placeholders
    const validMessages = messagesToPreview.filter(msg => msg !== null);
    console.log(`${pluginName}: handlePreviewFavoriteContext - Messages to preview (count: ${validMessages.length}):`, validMessages);

    if (validMessages.length === 0) {
        console.warn(`${pluginName}: handlePreviewFavoriteContext - No valid messages found to preview.`);
        await callGenericPopup('无法找到有效的消息进行预览。', POPUP_TYPE.WARNING);
        return;
    }

    // Open new tab
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
        await callGenericPopup('无法打开新标签页。请检查您的弹出窗口拦截器设置。', POPUP_TYPE.ERROR);
        return;
    }

    // Construct HTML for the new tab
    // *** IMPORTANT: VERIFY THESE CSS PATHS FOR YOUR SILLYTAVERN INSTALLATION ***
    // These paths are common but might differ based on setup or version.
    const cssPaths = [
        '/css/style.css',          // Main ST styles
        '/css/themes.css',         // Theme definitions (contains variables)
        '/css/font-awesome/css/all.min.css', // Font Awesome icons (if used by messages)
        // Try to find the currently active theme CSS file path. This is difficult.
        // We can get the theme name from settings, but mapping it to a file path reliably is tricky.
        // Best bet is to rely on style.css and themes.css + body class.
    ];
    let cssLinks = cssPaths.map(path => `<link rel="stylesheet" href="${path}">`).join('\n    ');

    // Basic fallback styles if external CSS fails
    // (Keep these updated based on core SillyTavern structure if possible)
    const fallbackStyles = `
        body { background-color: #2c2f33; color: #cccccc; font-family: 'Arial', sans-serif; padding: 15px; line-height: 1.6; }
        .mes_container { max-width: 900px; margin: 20px auto; border: 1px solid #444; border-radius: 8px; background-color: #23272a; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
        h2, p.preview-info { color: #ffffff; text-align: center; }
        hr { border: 0; height: 1px; background-color: #444; margin: 20px 0; }
        .mes { display: flex; margin-bottom: 15px; align-items: flex-start; flex-wrap: nowrap; } /* Ensure no wrap */
        .avatar { flex-shrink: 0; margin-right: 12px; width: 45px; height: 45px; }
        .avatar img { width: 100%; height: 100%; border-radius: 50%; border: 1px solid #555; object-fit: cover; }
        .mes_inner { border-radius: 8px; padding: 0; /* Remove padding here, apply to name/text */ flex-grow: 1; overflow: hidden; /* Prevent content spill */ }
        .mes_name { font-weight: bold; margin-bottom: 5px; color: #99aab5; font-size: 0.9em; padding: 8px 15px 0 15px; /* Pad name */ }
        .mes_text { color: #dcddde; word-wrap: break-word; white-space: pre-wrap; font-size: 1em; padding: 0 15px 8px 15px; /* Pad text */}
        .mes_text img { max-width: 100%; height: auto; display: block; margin-top: 5px; border-radius: 4px; } /* Style images inside text */
        /* User/Char distinction (simplified) */
        .char_mes .mes_inner { background-color: #36393f; }
        .char_mes .mes_name { color: #7289da; }
        .user_mes { flex-direction: row-reverse; }
        .user_mes .avatar { margin-right: 0; margin-left: 12px; }
        .user_mes .mes_inner { background-color: #4f545c; }
        .user_mes .mes_name { text-align: right; color: #aaa; /* User name color */ }
        .system_mes .mes_inner { background-color: rgba(255, 193, 7, 0.1); border-left: 3px solid #ffc107; }
        .system_mes .mes_name { color: #ffc107; }
        .system_mes .mes_text { font-style: italic; color: #ffebae; }
        /* Highlight the target message */
        .target-message .mes_inner { outline: 2px solid #ffcc00; outline-offset: -2px; /* Highlight */ }
    `;

    // Try to get theme class from main body to apply in new tab
    const themeClass = $('body').attr('class') || ''; // Get all classes

    let previewHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>收藏消息预览 (ID: ${targetMessageId})</title>
    ${cssLinks} {/* Attempt to link external CSS */}
    <style>
        ${fallbackStyles} {/* Inline fallback styles */}
    </style>
</head>
<body class="${themeClass}"> {/* Apply theme class(es) if found */}
    <div class="mes_container">
        <h2>消息上下文预览</h2>
        <p class="preview-info"><i>这是收藏的消息 (ID: ${targetMessageId}) 及其相邻消息的快照。外观取决于样式表的加载情况。</i></p>
        <hr>
`;

        validMessages.forEach(msg => {
            if (!msg) return; // Should already be filtered

            const msgId = String($(msg).attr?.('mesid')); // Get the message ID for highlighting
            const isUser = msg.is_user;
            const isSystem = msg.is_system; // Check for system message flag
            const senderName = msg.name ? $('<div>').text(msg.name).html() : (isUser ? 'User' : (isSystem ? 'System' : 'Character')); // Escape sender name
            // *** IMPORTANT: Verify these avatar paths ***
            const defaultUserAvatar = '/img/user-default.png'; // Default user avatar path in ST
            const defaultCharAvatar = '/img/ai-default.png';  // Default AI/Char avatar path in ST
            // Use character's specific picture (msg.pic), fallback to default based on type
            let avatarSrc = defaultCharAvatar; // Default to AI
            if(isUser) {
                avatarSrc = msg.avatar || defaultUserAvatar; // User uses avatar field or user default
            } else if (!isSystem) {
                avatarSrc = msg.pic || defaultCharAvatar; // Character uses pic field or AI default
            } else {
                 avatarSrc = ''; // System messages might not have an avatar
            }
             // Basic escaping for the src attribute itself
             avatarSrc = avatarSrc ? $('<div>').attr('src', avatarSrc).attr('src') : '';


            // Directly use the raw 'mes' content. The browser renders the HTML within.
            const mesContent = typeof msg.mes === 'string' ? msg.mes : '[空消息或无效内容]';

            let mesClasses = 'mes';
            if (isUser) mesClasses += ' user_mes';
            else if (isSystem) mesClasses += ' system_mes';
            else mesClasses += ' char_mes'; // Default to character message styling

            // Add highlight class if it's the target message
            if (msgId === targetMessageId) {
                 mesClasses += ' target-message';
            }

            previewHtml += `
            <div class="${mesClasses}" mesid="${msgId || ''}">
                ${avatarSrc ? `
                <div class="avatar">
                    <img src="${avatarSrc}" alt="${senderName.replace(/"/g, '"')}" onerror="this.style.display='none'">
                </div>
                ` : '<div class="avatar"></div>' /* Placeholder if no avatar */}
                <div class="mes_inner">
                    <div class="mes_name">${senderName}</div>
                    {/* Directly insert the original message HTML content */}
                    <div class="mes_text">${mesContent}</div>
                </div>
            </div>
            `;
        });

        previewHtml += `
    </div>
</body>
</html>
`;

        // Write content to the new tab
        try {
            previewWindow.document.open();
            previewWindow.document.write(previewHtml);
            previewWindow.document.close();
            console.log(`${pluginName}: handlePreviewFavoriteContext - Preview tab content written.`);
            previewWindow.focus(); // Bring the new tab to the front
        } catch (writeError) {
             console.error(`${pluginName}: Error writing to preview window:`, writeError);
             await callGenericPopup('写入预览内容时出错。', POPUP_TYPE.ERROR);
             try { previewWindow.close(); } catch {} // Try to close the potentially broken window
        }
    }


/**
 * Handles the deletion of a favorite from the popup
 * @param {string} favId The favorite ID
 * @param {string} messageId The message ID (mesid string)
 */
async function handleDeleteFavoriteFromPopup(favId, messageId) {
    // Use callGenericPopup for confirmation
    const confirmResult = await callGenericPopup(`确定要删除这条收藏吗？\n(消息 ID: ${messageId})`, POPUP_TYPE.CONFIRM);

    if (confirmResult === POPUP_RESULT.AFFIRMATIVE) { // Check for affirmative result
        if (removeFavoriteById(favId)) { // This function handles saving
            updateFavoritesPopup(); // Update the popup list

            // Update the star icon on the original message in the main chat view
            const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
            if (messageElement.length) {
                const iconElement = messageElement.find('.favorite-toggle-icon i');
                if (iconElement.length) {
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                }
            }
            // Optionally show a success toast/popup
            // toastr.success('收藏已删除');
        } else {
             await callGenericPopup('删除收藏失败。', POPUP_TYPE.ERROR);
        }
    } else {
        console.log(`${pluginName}: Deletion cancelled by user for favId ${favId}`);
    }
}

/**
 * Handles editing the note for a favorite
 * @param {string} favId The favorite ID
 */
async function handleEditNote(favId) {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites)) return;

    const favorite = chatMetadata.favorites.find(fav => fav.id === favId);
    if (!favorite) {
        console.warn(`${pluginName}: handleEditNote - Favorite with id ${favId} not found.`);
        await callGenericPopup('找不到要编辑的收藏项。', POPUP_TYPE.WARNING);
        return;
    }

    // Use callGenericPopup for input
    const result = await callGenericPopup('为这条收藏添加或编辑备注:', POPUP_TYPE.INPUT, favorite.note || '');

    // Check if the user confirmed (result is the input string, or '' for empty input)
    // Result will be null if cancelled, false if negative button clicked (though INPUT usually only has OK/Cancel)
    if (result !== null && result !== false) {
        updateFavoriteNote(favId, String(result)); // Ensure result is a string, handles saving
        updateFavoritesPopup(); // Update the popup list to show the new note
        // Optionally show success toast
        // toastr.success('备注已更新');
    } else {
         console.log(`${pluginName}: Note edit cancelled for favId ${favId}`);
    }
}


/**
 * Clears invalid favorites (those referencing non-existent messages)
 * Uses messageId (mesid string) for checking existence.
 */
async function handleClearInvalidFavorites() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
        await callGenericPopup('当前没有收藏项可清理。', POPUP_TYPE.TEXT);
        return;
    }

    const context = getContext();
    if (!context || !context.chat) {
         await callGenericPopup('无法获取当前聊天信息以清理收藏。', POPUP_TYPE.ERROR);
         return;
    }

    const invalidFavoritesData = []; // Store { id, messageId } of invalid favorites
    const validFavorites = [];    // Store valid favorite items

    // Create a set of existing message IDs (mesid strings) from the current chat for quick lookup
    const existingMessageIds = new Set();
    context.chat.forEach(msg => {
        const mesid = $(msg).attr?.('mesid');
        if (mesid) {
            existingMessageIds.add(String(mesid));
        }
        // Also consider msg.id if it might be used as messageId in favorites
        if (msg.id) {
             existingMessageIds.add(String(msg.id));
        }
    });

    chatMetadata.favorites.forEach(fav => {
        // Check if the favorite's messageId exists in the set of current message IDs
        if (existingMessageIds.has(String(fav.messageId))) {
            validFavorites.push(fav); // Keep valid favorite
        } else {
            invalidFavoritesData.push({ id: fav.id, messageId: fav.messageId }); // Mark favorite as invalid
            console.log(`${pluginName}: Found invalid favorite referencing messageId: ${fav.messageId}`);
        }
    });

    if (invalidFavoritesData.length === 0) {
        await callGenericPopup('没有找到无效的收藏项。', POPUP_TYPE.TEXT);
        return;
    }

    // Confirm deletion with the user
    const confirmResult = await callGenericPopup(
        `发现 ${invalidFavoritesData.length} 条引用无效或已删除消息的收藏项。确定要删除这些无效收藏吗？`,
        POPUP_TYPE.CONFIRM // Use CONFIRM type
    );

    if (confirmResult === POPUP_RESULT.AFFIRMATIVE) { // Check for affirmative result
        chatMetadata.favorites = validFavorites; // Replace with the filtered list
        saveMetadataDebounced(); // Save the changes

        await callGenericPopup(`已成功清理 ${invalidFavoritesData.length} 条无效收藏。`, POPUP_TYPE.TEXT);
        updateFavoritesPopup(); // Update the popup display
        refreshFavoriteIconsInView(); // Refresh icons in chat
    } else {
        console.log(`${pluginName}: Clearing invalid favorites cancelled by user.`);
    }
}


/**
 * Main entry point for the plugin
 */
jQuery(async () => {
    // pluginName is defined at the top

    try {
        console.log(`${pluginName}: 插件加载中...`);

        // Add button to the data bank wand container
        try {
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
            $('#data_bank_wand_container').append(inputButtonHtml);
            console.log(`${pluginName}: 已将按钮添加到 #data_bank_wand_container`);

            // Attach click listener to the newly added button
            $('#favorites_button').on('click', () => {
                console.log(`${pluginName}: Favorites button clicked.`);
                showFavoritesPopup();
            });
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 input_button.html 失败:`, error);
        }

        // Add settings display to extension settings area
        try {
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
            // Append to a standard container for extension settings if available
            $('#extensions_settings').append(settingsHtml);
            console.log(`${pluginName}: 已将设置 UI 添加到 #extensions_settings`);
            // Make settings collapsible (assuming inline-drawer structure from HTML)
            $('.inline-drawer-toggle').on('click', function () {
                $(this).closest('.inline-drawer').toggleClass('open');
            });
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 settings_display.html 失败:`, error);
        }

        // Set up event delegation for favorite toggle icon clicks anywhere on the document
        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);

        // Initialize favorites array for the current chat when the plugin loads
        ensureFavoritesArrayExists(); // Attempt initialization

        // Initial UI setup: Add icons to existing messages and set their correct state
        // Delay slightly to ensure DOM is ready after initial load
        setTimeout(() => {
            addFavoriteIconsToMessages();
            refreshFavoriteIconsInView();
        }, 200);


        // --- Event Listeners ---
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log(`${pluginName}: Event ${event_types.CHAT_CHANGED} detected.`);
            ensureFavoritesArrayExists(); // Ensure the array exists for the new chat
            // Delay updates to allow ST to fully render the new chat
            setTimeout(() => {
                addFavoriteIconsToMessages(); // Add icons structure to potentially new messages
                refreshFavoriteIconsInView(); // Update all icons based on the new chat's metadata
                 // Close the popup if it's open when chat changes, as context is lost
                 if (favoritesPopup && favoritesPopup.dlg && favoritesPopup.dlg.open) {
                    console.log(`${pluginName}: Closing favorites popup due to chat change.`);
                     if (typeof favoritesPopup.completeCancelled === 'function') {
                        favoritesPopup.completeCancelled();
                     } else {
                        favoritesPopup.dlg.close();
                     }
                 }
            }, 300); // Increased delay for chat changes
        });

        eventSource.on(event_types.MESSAGE_DELETED, (deletedMessageData) => {
             console.log(`${pluginName}: Event ${event_types.MESSAGE_DELETED} detected with data:`, deletedMessageData);
            // Extract the message ID (mesid string) or index string
            let deletedMessageId = null;
            if (typeof deletedMessageData === 'object' && deletedMessageData.id) {
                deletedMessageId = String(deletedMessageData.id); // Prefer the mesid string if provided
            } else if (typeof deletedMessageData === 'number') {
                deletedMessageId = String(deletedMessageData); // Fallback to index as string
            } else if (typeof deletedMessageData === 'string') {
                deletedMessageId = deletedMessageData; // If it's already a string (potentially mesid)
            }

            if (!deletedMessageId) {
                 console.warn(`${pluginName}: Received MESSAGE_DELETED event with unclear message identifier:`, deletedMessageData);
                 return;
            }

            console.log(`${pluginName}: Processing deletion for message identifier: ${deletedMessageId}`);
            const chatMetadata = ensureFavoritesArrayExists();
            if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) return;

            // Find if any favorite references this messageId
            const favIndex = chatMetadata.favorites.findIndex(fav => fav.messageId === deletedMessageId);

            if (favIndex !== -1) {
                const removedFav = chatMetadata.favorites.splice(favIndex, 1)[0];
                console.log(`${pluginName}: Message ${deletedMessageId} deleted, removing corresponding favorite:`, removedFav);
                saveMetadataDebounced(); // Save changes

                // Update the popup if it's open
                if (favoritesPopup && favoritesPopup.dlg && favoritesPopup.dlg.open) {
                    updateFavoritesPopup();
                }
            } else {
                 console.log(`${pluginName}: No favorite found referencing deleted message identifier ${deletedMessageId}.`);
            }
        });

        // Listener for when new messages appear (sent or received)
        const handleNewMessage = (messageDataOrIndex) => {
            console.log(`${pluginName}: Event MESSAGE_RECEIVED or MESSAGE_SENT detected.`);
             // Delay slightly to ensure the message element exists in the DOM
             setTimeout(() => {
                 addFavoriteIconsToMessages(); // Re-run to catch the new message(s)
             }, 200);
        };
        eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);
        eventSource.on(event_types.MESSAGE_UPDATED, (updateData) => {
            console.log(`${pluginName}: Event MESSAGE_UPDATED detected.`);
             // A message update might change its content, potentially affecting favorites if metadata were stored
             // For now, just ensure icons are correct (state shouldn't change unless fav status is part of update?)
             setTimeout(() => refreshFavoriteIconsInView(), 150);
        });


        // Listener for when more messages are loaded (scrolling up)
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
             console.log(`${pluginName}: Event MORE_MESSAGES_LOADED detected.`);
             // Delay to allow messages to render
             setTimeout(() => {
                 addFavoriteIconsToMessages(); // Add icon structure to newly loaded messages
                 refreshFavoriteIconsInView(); // Refresh the state of all visible icons
             }, 250);
        });

        // Using MutationObserver as a robust fallback for DOM changes
        const chatObserver = new MutationObserver((mutations) => {
            let needsIconAddition = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        // Check if the added node is an element and is/contains a '.mes'
                        if (node.nodeType === 1 && (node.matches('.mes') || node.querySelector('.mes'))) {
                            needsIconAddition = true;
                        }
                    });
                }
                // Optimization: break early if change detected
                if (needsIconAddition) break;
            }

            if (needsIconAddition) {
                 // Debounce or throttle this if it triggers too frequently
                 setTimeout(() => {
                     console.log(`${pluginName}: MutationObserver detected added message nodes, ensuring icons...`);
                     addFavoriteIconsToMessages();
                     // Refresh might be needed if elements were replaced, not just added
                     refreshFavoriteIconsInView();
                 }, 300); // Debounce delay
            }
        });

        const chatElement = document.getElementById('chat');
        if (chatElement) {
            chatObserver.observe(chatElement, {
                childList: true, // Observe direct children additions/removals
                subtree: true    // Observe additions/removals in descendants too
            });
             console.log(`${pluginName}: MutationObserver started monitoring #chat.`);
        } else {
             console.error(`${pluginName}: Could not find #chat element to observe.`);
        }


        console.log(`${pluginName}: 插件加载完成!`);
    } catch (error) {
        console.error(`${pluginName}: Initialization error:`, error);
        // Display error to user
        try {
            callGenericPopup(`收藏夹插件初始化失败: ${error.message}`, POPUP_TYPE.ERROR);
        } catch {}
    }
});
