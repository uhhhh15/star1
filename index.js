// public/extensions/third-party/favorites-plugin/index_new.js

// Import from the core script
import {
    eventSource,
    event_types,
    messageFormatting,
} from '../../../../script.js';

// Import from the extension helper script
import {
    getContext,
    renderExtensionTemplateAsync,
    extension_settings,
    saveMetadataDebounced
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
    // timestampToMoment, // 不再需要
} from '../../../utils.js';

// Define plugin folder name (important for consistency)
const pluginName = 'starZ'; // 统一使用这个名称

// Initialize plugin settings if they don't exist
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
        if (!context || !context.chatMetadata) {
            console.error(`${pluginName}: ensureFavoritesArrayExists - context or context.chatMetadata is not available!`);
            return null;
        }
    } catch (e) {
        console.error(`${pluginName}: ensureFavoritesArrayExists - Error calling getContext():`, e);
        return null;
    }

    const chatMetadata = context.chatMetadata;
    if (!Array.isArray(chatMetadata.favorites)) {
        console.log(`${pluginName}: Initializing chatMetadata.favorites array.`);
        chatMetadata.favorites = [];
    }
    return chatMetadata;
}


/**
 * Adds a favorite item to the current chat metadata
 * @param {Object} messageInfo Information about the message being favorited
 */
function addFavorite(messageInfo) {
    console.log(`${pluginName}: addFavorite 函数开始执行，接收到的 messageInfo:`, messageInfo);

    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata) {
         console.error(`${pluginName}: addFavorite - 获取 chatMetadata 失败，退出`);
         return;
    }

    const item = {
        id: uuidv4(),
        messageId: messageInfo.messageId, // Stores the message index as a string ('mesid')
        sender: messageInfo.sender,
        role: messageInfo.role,
        note: ''
    };

    if (!Array.isArray(chatMetadata.favorites)) {
        console.error(`${pluginName}: addFavorite - chatMetadata.favorites 不是数组，无法添加！`);
        return;
    }

    console.log(`${pluginName}: 添加前 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));
    chatMetadata.favorites.push(item);
    console.log(`${pluginName}: 添加后 chatMetadata.favorites:`, JSON.stringify(chatMetadata.favorites));

    console.log(`${pluginName}: 即将调用 (导入的) saveMetadataDebounced 来保存更改...`);
    saveMetadataDebounced();

    console.log(`${pluginName}: Added favorite:`, item);
    if (favoritesPopup && favoritesPopup.isVisible()) {
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
        saveMetadataDebounced();
        console.log(`${pluginName}: Favorite removed: ${favoriteId}`);
        return true;
    }

    console.warn(`${pluginName}: Favorite with id ${favoriteId} not found.`);
    return false;
}

/**
 * Removes a favorite by the message ID it references
 * @param {string} messageId The message ID (from mesid attribute, which is the index as string)
 * @returns {boolean} True if successful, false otherwise
 */
function removeFavoriteByMessageId(messageId) {
    console.log(`${pluginName}: removeFavoriteByMessageId - 尝试删除 messageId: ${messageId}`);
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
         console.warn(`${pluginName}: removeFavoriteByMessageId - chatMetadata 无效或 favorites 数组为空`);
         return false;
    }

    // 根据 messageId (mesid string) 查找收藏项
    const favItem = chatMetadata.favorites.find(fav => fav.messageId === messageId);
    if (favItem) {
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
        saveMetadataDebounced();
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
    if (!target.length) return;

    const messageElement = target.closest('.mes');
    if (!messageElement || !messageElement.length) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：无法找到父级 .mes 元素`);
        return;
    }

    const messageIdString = messageElement.attr('mesid'); // This is the index as a string
    if (!messageIdString) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：未找到 mesid 属性`);
        return;
    }

    const messageIndex = parseInt(messageIdString, 10);
    if (isNaN(messageIndex)) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：mesid 解析为 NaN: ${messageIdString}`);
        return;
    }

    console.log(`${pluginName}: handleFavoriteToggle - 获取 context 和消息对象 (索引: ${messageIndex})`);
    let context;
    try {
        context = getContext();
        if (!context || !context.chat || !Array.isArray(context.chat)) {
            console.error(`${pluginName}: handleFavoriteToggle - 退出：getContext() 返回无效或缺少 chat 数组`);
            return;
        }
    } catch (e) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：调用 getContext() 时出错:`, e);
        return;
    }

    const message = context.chat[messageIndex];
    if (!message) {
        // Attempt to find the message based on the element's mesid attribute again,
        // in case the context.chat array index doesn't directly match the mesid value anymore
        // (This is less likely if mesid *is* the index, but good to have a fallback)
        const foundMsg = context.chat.find((msg, idx) => String(idx) === messageIdString || $(msg.swipes?.[msg.swipe_id])?.closest('.mes')?.attr('mesid') === messageIdString);
        if(!foundMsg){
            console.error(`${pluginName}: handleFavoriteToggle - 退出：在索引 ${messageIndex} 或通过 mesid ${messageIdString} 均未找到消息对象`);
            return;
        }
        // If found via fallback, use that message (though the index might be different)
        // message = foundMsg; // Re-assigning might complicate things, stick to index logic for now if possible.
        console.warn(`${pluginName}: handleFavoriteToggle - Message not found at index ${messageIndex}, but potentially found via mesid lookup. Proceeding with index ${messageIndex} for consistency.`);
        // It's better to rely on the mesid being the correct index for add/remove operations
        // If the message object itself is needed here, fetch it using the index.
        const actualMessage = context.chat[messageIndex];
         if (!actualMessage) {
             console.error(`${pluginName}: handleFavoriteToggle - Exit: Message object still not found at index ${messageIndex}.`);
             return;
         }
         console.log(`${pluginName}: handleFavoriteToggle - Successfully retrieved message object using index ${messageIndex}:`, actualMessage);


    } else {
         console.log(`${pluginName}: handleFavoriteToggle - 成功获取消息对象:`, message);
    }


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

    // Fetch the message object again specifically for addFavorite, ensuring we have name/is_user
    const messageForAdd = context.chat[messageIndex];
    if (!messageForAdd) {
         console.error(`${pluginName}: handleFavoriteToggle - Cannot add favorite, message object not found at index ${messageIndex}.`);
         // Revert UI change if needed
         if (!isCurrentlyFavorited) { // It was toggled to solid, revert to regular
              iconElement.removeClass('fa-solid').addClass('fa-regular');
         } else { // It was toggled to regular, revert to solid
             iconElement.removeClass('fa-regular').addClass('fa-solid');
         }
         return;
    }


    if (!isCurrentlyFavorited) {
        console.log(`${pluginName}: handleFavoriteToggle - 准备调用 addFavorite`);
        const messageInfo = {
            messageId: messageIdString, // Pass the index string ('mesid')
            sender: messageForAdd.name,
            role: messageForAdd.is_user ? 'user' : 'character',
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
            removeFavoriteByMessageId(messageIdString); // Pass the index string ('mesid')
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
        // Ensure the message has a mesid before adding the button
        if (!messageElement.attr('mesid')) {
            // console.warn(`${pluginName}: Message element found without mesid, skipping favorite icon addition.`);
            return; // Skip this message
        }
        const extraButtonsContainer = messageElement.find('.extraMesButtons');
        if (extraButtonsContainer.length && !extraButtonsContainer.find('.favorite-toggle-icon').length) {
            extraButtonsContainer.append(messageButtonHtml);
        }
    });
}

/**
 * Updates all favorite icons in the current view to reflect current state
 */
function refreshFavoriteIconsInView() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites)) {
        console.warn(`${pluginName}: refreshFavoriteIconsInView - 无法获取有效的 chatMetadata 或 favorites 数组`);
        $('#chat').find('.favorite-toggle-icon i').removeClass('fa-solid').addClass('fa-regular');
        return;
    }

    addFavoriteIconsToMessages();

    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const messageId = messageElement.attr('mesid'); // index string

        if (messageId) {
            const isFavorited = chatMetadata.favorites.some(fav => fav.messageId === messageId);
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
 * @param {number} index Index of the item in the sorted favorites list (used for display only)
 * @returns {string} HTML string for the favorite item
 */
function renderFavoriteItem(favItem, index) {
    if (!favItem) return '';

    const context = getContext();
    const messageIndex = parseInt(favItem.messageId, 10); // Parse the stored index string
    let message = null;
    let previewText = '';
    let deletedClass = '';

    if (!isNaN(messageIndex) && context.chat && context.chat[messageIndex]) {
         // Check if the message at the index still conceptually matches (e.g., sender, role)
         // Basic check:
         message = context.chat[messageIndex];

         // More robust check (optional, might be slow): Check if message's own mesid matches
         // const elementMesId = $(message.swipes?.[message.swipe_id])?.closest('.mes')?.attr('mesid');
         // if (elementMesId === favItem.messageId) {
         //    message = context.chat[messageIndex];
         // } else {
         //    console.warn(`${pluginName}: Message at index ${messageIndex} has mesid ${elementMesId}, but favorite references ${favItem.messageId}. Using message at index.`);
         //    // Decide how to handle mismatch - proceed with index or mark as potentially invalid? For now, proceed.
         //    message = context.chat[messageIndex];
         // }
    }

    if (message && message.mes) {
        previewText = message.mes; // Get the full original message content

        // --- Keep formatting for the inline preview ---
        try {
             previewText = messageFormatting(previewText, favItem.sender, false, // isEdited = false
                                            favItem.role === 'user', null, {}, false); // escape = false
        } catch (e) {
             console.error(`${pluginName}: Error formatting message preview for ${favItem.id}:`, e);
             // Fallback to plain text, but use the CSS class for overflow/wrapping
             previewText = `<div style="white-space: pre-wrap; word-wrap: break-word;">${message.mes.replace(/</g, "<").replace(/>/g, ">")}</div>`;
        }
        // --- Formatting end ---

    } else {
        previewText = '[消息内容不可用或已删除]';
        deletedClass = 'deleted';
    }

    // Add the preview button
    return `
        <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}" data-index="${index}">
            <div class="fav-meta">${favItem.sender} (${favItem.role})</div>
            <div class="fav-note" style="${favItem.note ? '' : 'display:none;'}">备注：${favItem.note || ''}</div>
            {/* This div contains the potentially formatted, possibly truncated preview */}
            <div class="fav-preview ${deletedClass}">${previewText}</div>
            <div class="fav-actions">
                <i class="fa-solid fa-eye preview-fav" title="预览上下文"></i> {/* <-- Preview Button Added */}
                <i class="fa-solid fa-pencil edit-fav" title="编辑备注"></i>
                <i class="fa-solid fa-trash delete-fav" title="删除收藏"></i>
            </div>
        </div>
    `;
}

/**
 * Renders a single message for the preview tab using messageFormatting
 * @param {object} message The message object from context.chat
 * @param {string} mesId The mesid string (index) for reference
 * @returns {string} HTML string for the rendered message
 */
function renderSingleMessageForPreview(message, mesId) {
    if (!message) return '';
    try {
        // Use messageFormatting to get consistent rendering
        const formattedContent = messageFormatting(
            message.mes,
            message.name,
            message.is_edited,
            message.is_user,
            null, // Online status - not relevant here
            {},   // persona // Pass empty object if not available/needed
            false // escape = false, assume messageFormatting handles necessary escaping
        );
        // Wrap in a .mes-like structure for styling in the new tab
        // Add mesid for potential reference, though it won't be interactive
        return `
            <div class="mes ${message.is_user ? 'user' : 'char'}" mesid="${mesId || ''}">
                <div class="message ${message.is_user ? 'message_user' : 'message_bot'}">
                    <div class="name">${message.name}</div>
                    <div class="content">${formattedContent}</div>
                </div>
            </div>
        `;
    } catch (e) {
        console.error(`${pluginName}: Error formatting message for preview (mesId: ${mesId}):`, e);
        // Fallback to basic rendering
        return `
            <div class="mes ${message.is_user ? 'user' : 'char'}" mesid="${mesId || ''}">
                <div class="message ${message.is_user ? 'message_user' : 'message_bot'}">
                     <div class="name">${message.name || 'Unknown'}</div>
                     <div class="content" style="white-space: pre-wrap; word-wrap: break-word;">[渲染错误] ${message.mes?.replace(/</g, "<").replace(/>/g, ">") || '[内容不可用]'}</div>
                </div>
            </div>
        `;
    }
}

/**
 * Handles the click on the "Preview" button in the favorites popup
 * @param {string} messageId The message ID (mesid string, index) of the favorited item
 */
async function handlePreviewFavorite(messageId) {
    console.log(`${pluginName}: handlePreviewFavorite - msgId: ${messageId}`);
    let context;
    try {
        context = getContext();
        if (!context || !context.chat || !Array.isArray(context.chat)) {
            console.error(`${pluginName}: handlePreviewFavorite - Invalid context or chat array.`);
            await callGenericPopup("无法加载聊天内容以进行预览。", POPUP_TYPE.ERROR);
            return;
        }
    } catch (e) {
        console.error(`${pluginName}: handlePreviewFavorite - Error getting context:`, e);
        await callGenericPopup("获取聊天内容时出错。", POPUP_TYPE.ERROR);
        return;
    }

    const chat = context.chat;
    const targetIndex = parseInt(messageId, 10);

    if (isNaN(targetIndex) || targetIndex < 0 || targetIndex >= chat.length) {
        console.error(`${pluginName}: handlePreviewFavorite - Invalid message index: ${targetIndex} from msgId: ${messageId}`);
        await callGenericPopup("无法找到对应的消息索引。", POPUP_TYPE.ERROR);
        return;
    }

    // Get the messages: previous, current, next
    const messagePrev = targetIndex > 0 ? chat[targetIndex - 1] : null;
    const messageCurrent = chat[targetIndex];
    const messageNext = targetIndex < chat.length - 1 ? chat[targetIndex + 1] : null;

    // Find the corresponding mesid attributes for prev/next if possible
    // This assumes mesid is reliably the index string.
    const mesIdPrev = messagePrev ? String(targetIndex - 1) : null;
    const mesIdCurrent = String(targetIndex);
    const mesIdNext = messageNext ? String(targetIndex + 1) : null;


    // Start building HTML for the new tab
    let previewHtmlContent = `
        <!DOCTYPE html>
        <html lang="zh">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>收藏消息预览 (ID: ${messageId})</title>
            <style>
                /* Basic styles - copy relevant parts from main CSS and style.css */
                body { font-family: sans-serif; padding: 15px; background-color: #222; color: #eee; }
                .preview-container { max-width: 800px; margin: 0 auto; background-color: #333; padding: 10px; border-radius: 8px; }
                h1 { text-align: center; color: #ffcc00; margin-bottom: 20px; }
                .mes { margin-bottom: 15px; display: flex; }
                .mes.user { justify-content: flex-end; }
                .mes.char { justify-content: flex-start; }
                .message { padding: 10px 15px; border-radius: 15px; max-width: 75%; word-wrap: break-word; white-space: pre-wrap; line-height: 1.5; }
                .message_user { background-color: #4a90e2; color: #fff; border-bottom-right-radius: 5px; }
                .message_bot { background-color: #555; color: #eee; border-bottom-left-radius: 5px; }
                .name { font-weight: bold; margin-bottom: 5px; font-size: 0.9em; color: #ccc; }
                .mes.user .name { text-align: right; }
                .content { /* messageFormatting should handle internal styling */ }
                .highlight { border: 2px solid #ffcc00; box-shadow: 0 0 10px #ffcc00; } /* Style for the favorited message */

                /* Add styles for code blocks, blockquotes etc. if messageFormatting generates them */
                code { background-color: #444; padding: 0.2em 0.4em; border-radius: 3px; font-family: monospace; }
                pre { background-color: #2d2d2d; padding: 10px; border-radius: 5px; overflow-x: auto; }
                pre code { background-color: transparent; padding: 0; }
                blockquote { border-left: 4px solid #777; padding-left: 10px; margin-left: 0; color: #bbb; font-style: italic; }

                 /* Include styles from your style.css if needed, e.g., for fav-preview internal elements if formatting relies on them */
                 .fav-preview { /* Maybe not needed directly here if renderSingleMessageForPreview handles it */ }
            </style>
        </head>
        <body>
            <div class="preview-container">
                <h1>消息预览</h1>
    `;

    // Render messages
    if (messagePrev) {
        previewHtmlContent += renderSingleMessageForPreview(messagePrev, mesIdPrev);
    }
    if (messageCurrent) {
        // Add a highlight class to the current message's wrapper
        let currentMessageHtml = renderSingleMessageForPreview(messageCurrent, mesIdCurrent);
        currentMessageHtml = currentMessageHtml.replace('<div class="mes ', '<div class="mes highlight '); // Add highlight class
        previewHtmlContent += currentMessageHtml;
    } else {
         previewHtmlContent += `<div class="mes"><div class="message message_bot" style="background-color: #800; color: #fff;">[错误：无法加载当前收藏的消息 (ID: ${messageId})]</div></div>`;
    }
    if (messageNext) {
        previewHtmlContent += renderSingleMessageForPreview(messageNext, mesIdNext);
    }

    previewHtmlContent += `
            </div>
        </body>
        </html>
    `;

    // Open new tab and write content
    try {
        const newTab = window.open('', '_blank');
        if (newTab) {
            newTab.document.open();
            newTab.document.write(previewHtmlContent);
            newTab.document.close();
            console.log(`${pluginName}: Preview tab opened for message ${messageId}.`);
        } else {
            console.error(`${pluginName}: Failed to open new tab. 可能被浏览器拦截。`);
            await callGenericPopup("无法打开新标签页，请检查浏览器设置是否允许弹出窗口。", POPUP_TYPE.ERROR);
        }
    } catch (e) {
        console.error(`${pluginName}: Error opening or writing to new tab:`, e);
        await callGenericPopup("打开预览标签页时出错。", POPUP_TYPE.ERROR);
    }
}


/**
 * Updates the favorites popup with current data
 */
function updateFavoritesPopup() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!favoritesPopup || !chatMetadata) {
        console.error(`${pluginName}: updateFavoritesPopup - Popup not ready or chatMetadata missing.`);
        return;
    }
    if (!favoritesPopup.content) {
        console.error(`${pluginName}: updateFavoritesPopup - favoritesPopup.content is null or undefined! Cannot update.`);
        return;
    }
    console.log(`${pluginName}: updateFavoritesPopup - favoritesPopup.content element:`, favoritesPopup.content);

    const context = getContext();
    const chatName = context?.characterId ? context?.name2 : `群组: ${context?.groups?.find(g => g.id === context.groupId)?.name || '未命名群组'}`;
    const totalFavorites = chatMetadata.favorites ? chatMetadata.favorites.length : 0;
    // Sort by messageId (index string) numerically, descending (newest first)
    const sortedFavorites = chatMetadata.favorites ? [...chatMetadata.favorites].sort((a, b) => parseInt(b.messageId) - parseInt(a.messageId)) : [];

    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalFavorites);
    const currentPageItems = sortedFavorites.slice(startIndex, endIndex);

    let contentHtml = `
        <div id="favorites-popup-content">
            <div class="favorites-header">
                <h3>${chatName || '未知聊天'} - ${totalFavorites} 条收藏</h3>
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-list">
    `;

    if (totalFavorites === 0) {
        contentHtml += `<div class="favorites-empty">当前没有收藏的消息。点击消息右下角的星形图标来添加收藏。</div>`;
    } else {
        currentPageItems.forEach((favItem, index) => {
            // Pass the index relative to the start of the current page items
            contentHtml += renderFavoriteItem(favItem, startIndex + index);
        });

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
        try {
            favoritesPopup = new Popup(
                '<div class="spinner"></div>', // Initial content while loading
                POPUP_TYPE.TEXT, // Use TEXT type, we manage content and buttons manually
                '', // No default input value
                {
                    title: '收藏管理',
                    wide: true, // Make it wider
                    okButton: false, // Hide default OK
                    cancelButton: false, // Hide default Cancel
                    allowVerticalScrolling: true, // Allow scrolling within the popup content
                    // We will add buttons manually or handle clicks inside the content
                }
            );

            console.log(`${pluginName}: Popup instance created successfully.`);

            // Attach event listener using jQuery delegation ON THE POPUP'S CONTENT ELEMENT
            $(favoritesPopup.content).on('click', function(event) {
                const target = $(event.target); // The actual clicked element
                const favItem = target.closest('.favorite-item'); // Find parent favorite item if click was inside one

                // Handle pagination
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
                // Handle close button
                else if (target.hasClass('close-popup')) {
                    favoritesPopup.hide();
                }
                // Handle clear invalid button
                else if (target.hasClass('clear-invalid')) {
                    handleClearInvalidFavorites();
                }
                // Handle Preview click (new)
                else if (target.hasClass('preview-fav')) {
                     if (favItem && favItem.length) {
                         const msgId = favItem.data('msg-id'); // Get the messageId (index string)
                         if (msgId !== undefined) { // Check if msgId exists
                             handlePreviewFavorite(String(msgId)); // Pass the string representation
                         } else {
                             console.warn(`${pluginName}: Clicked preview icon, but couldn't find data-msg-id on parent .favorite-item`);
                         }
                     } else {
                         console.warn(`${pluginName}: Clicked preview icon, but couldn't find parent .favorite-item`);
                     }
                }
                // Handle edit note (pencil icon)
                else if (target.hasClass('edit-fav')) { // Changed class selector
                    if (favItem && favItem.length) {
                         const favId = favItem.data('fav-id');
                         if (favId) {
                            handleEditNote(favId);
                         } else {
                             console.warn(`${pluginName}: Clicked edit icon, but couldn't find data-fav-id on parent .favorite-item`);
                         }
                    } else {
                         console.warn(`${pluginName}: Clicked edit icon, but couldn't find parent .favorite-item`);
                    }
                }
                // Handle delete favorite (trash icon)
                else if (target.hasClass('delete-fav')) { // Changed class selector
                     if (favItem && favItem.length) {
                        const favId = favItem.data('fav-id');
                        const msgId = favItem.data('msg-id');
                        if (favId && msgId !== undefined) { // Check both exist
                           handleDeleteFavoriteFromPopup(favId, String(msgId)); // Ensure msgId is string
                        } else {
                             console.warn(`${pluginName}: Clicked delete icon, but couldn't find data-fav-id or data-msg-id on parent .favorite-item`);
                        }
                    } else {
                         console.warn(`${pluginName}: Clicked delete icon, but couldn't find parent .favorite-item`);
                    }
                }
            });

        } catch (error) {
            console.error(`${pluginName}: Failed during popup creation or event listener setup:`, error);
            favoritesPopup = null; // Reset if creation failed
            return; // Don't proceed if popup failed
        }
    } else {
         console.log(`${pluginName}: Reusing existing popup instance.`);
    }

    // Reset to first page and update content every time it's shown
    currentPage = 1;
    updateFavoritesPopup(); // This function now sets the innerHTML of favoritesPopup.content

    if (favoritesPopup) {
        try {
            favoritesPopup.show(); // Show the popup
        } catch(showError) {
             console.error(`${pluginName}: Error showing popup:`, showError);
             // Consider resetting the popup instance if showing fails consistently
             // favoritesPopup = null;
        }
    }
}

/**
 * Handles the deletion of a favorite from the popup
 * @param {string} favId The favorite ID
 * @param {string} messageId The message ID (mesid string, index)
 */
async function handleDeleteFavoriteFromPopup(favId, messageId) {
    const confirmResult = await callGenericPopup('确定要删除这条收藏吗？', POPUP_TYPE.CONFIRM);

    if (confirmResult === POPUP_RESULT.YES) {
        if (removeFavoriteById(favId)) { // This handles saving
            updateFavoritesPopup(); // Update popup list

            // Update icon in main chat
            const messageElement = $(`#chat .mes[mesid="${messageId}"]`);
            if (messageElement.length) {
                const iconElement = messageElement.find('.favorite-toggle-icon i');
                if (iconElement.length) {
                    iconElement.removeClass('fa-solid').addClass('fa-regular');
                }
            }
        }
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
    if (!favorite) return;

    const result = await callGenericPopup('为这条收藏添加备注:', POPUP_TYPE.INPUT, favorite.note || '');

    if (result !== null && result !== POPUP_RESULT.CANCELLED) {
        updateFavoriteNote(favId, result); // This handles saving
        updateFavoritesPopup(); // Update popup list
    }
}


/**
 * Clears invalid favorites (those referencing non-existent message indices)
 */
async function handleClearInvalidFavorites() {
    const chatMetadata = ensureFavoritesArrayExists();
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) {
        await callGenericPopup('当前没有收藏项可清理。', POPUP_TYPE.TEXT);
        return;
    }

    let context;
    try {
        context = getContext();
        if (!context || !context.chat || !Array.isArray(context.chat)) {
            await callGenericPopup('无法获取当前聊天信息以清理收藏。', POPUP_TYPE.ERROR);
            return;
        }
    } catch (e) {
         await callGenericPopup('获取聊天信息时出错。', POPUP_TYPE.ERROR);
         return;
    }

    const chat = context.chat;
    const invalidFavoritesIds = [];
    const validFavorites = [];

    chatMetadata.favorites.forEach(fav => {
        const messageIndex = parseInt(fav.messageId, 10);
        // Check if the index is valid within the current chat array bounds
        if (!isNaN(messageIndex) && messageIndex >= 0 && messageIndex < chat.length) {
            // Optionally, add more checks here if needed (e.g., message content exists)
             if (chat[messageIndex]) { // Basic check if message object exists at index
                 validFavorites.push(fav);
             } else {
                 console.log(`${pluginName}: Invalid favorite found (message object missing at index ${messageIndex}): ${fav.id}`);
                 invalidFavoritesIds.push(fav.id);
             }
        } else {
            console.log(`${pluginName}: Invalid favorite found (index ${messageIndex} out of bounds or NaN): ${fav.id}`);
            invalidFavoritesIds.push(fav.id);
        }
    });

    if (invalidFavoritesIds.length === 0) {
        await callGenericPopup('没有找到无效的收藏项。', POPUP_TYPE.TEXT);
        return;
    }

    const confirmResult = await callGenericPopup(
        `发现 ${invalidFavoritesIds.length} 条引用无效或已删除消息的收藏项。确定要删除这些无效收藏吗？`,
        POPUP_TYPE.CONFIRM
    );

    if (confirmResult === POPUP_RESULT.YES) {
        chatMetadata.favorites = validFavorites; // Replace with the filtered list
        saveMetadataDebounced(); // Save the change

        await callGenericPopup(`已成功清理 ${invalidFavoritesIds.length} 条无效收藏。`, POPUP_TYPE.TEXT);
        updateFavoritesPopup(); // Update the popup display
    }
}


/**
 * Main entry point for the plugin
 */
jQuery(async () => {
    try {
        console.log(`${pluginName}: 插件加载中...`);

        // Add button to the data bank wand container
        try {
            const inputButtonHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'input_button');
            $('#data_bank_wand_container').append(inputButtonHtml);
            console.log(`${pluginName}: 已将按钮添加到 #data_bank_wand_container`);

            $('#favorites_button').on('click', () => {
                showFavoritesPopup();
            });
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 input_button.html 失败:`, error);
        }

        // Add settings UI
        try {
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
            // Ensure the target container exists before appending
            const settingsContainer = $('#extension_settings').find(`[data-extension_name="${pluginName}"]`); // Standard location
             if (settingsContainer.length) {
                 settingsContainer.append(settingsHtml);
                 console.log(`${pluginName}: 已将设置 UI 添加到扩展设置区域`);
             } else {
                 // Fallback or alternative location if standard doesn't exist
                 $('#translation_container').append(settingsHtml); // Original fallback
                 console.warn(`${pluginName}: 未找到标准设置容器，已将设置 UI 添加到 #translation_container`);
             }

             // Initialize drawer toggle if it uses standard classes
             $('.inline-drawer-toggle').on('click', function () {
                const drawer = $(this).closest('.inline-drawer');
                const icon = $(this).find('.inline-drawer-icon');
                const content = drawer.find('.inline-drawer-content');
                content.slideToggle(); // Use slideToggle for animation
                icon.toggleClass('down up');
            });
             // Ensure initial state is closed
             $('.inline-drawer-content').hide();
             $('.inline-drawer-icon').addClass('down').removeClass('up');


        } catch (error) {
            console.error(`${pluginName}: 加载或注入 settings_display.html 失败:`, error);
        }


        // Set up event delegation for favorite toggle icon clicks on messages
        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);

        // Initialize favorites array for the current chat on load
        ensureFavoritesArrayExists();

        // Initial UI setup: add icons and refresh their states
        addFavoriteIconsToMessages();
        refreshFavoriteIconsInView();

        // --- Event Listeners ---
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log(`${pluginName}: 聊天已更改，更新收藏图标...`);
            ensureFavoritesArrayExists(); // Ensure array exists for the new chat
            setTimeout(() => {
                addFavoriteIconsToMessages(); // Add icons to any new messages
                refreshFavoriteIconsInView(); // Refresh states for all visible messages
            }, 150); // Slightly longer delay might be needed after chat change
        });

        // When a message is deleted (event usually passes the index)
        eventSource.on(event_types.MESSAGE_DELETED, (deletedMessageIndex) => {
             const deletedMessageIdString = String(deletedMessageIndex); // Convert index to string for comparison
             console.log(`${pluginName}: 检测到消息删除事件, 索引: ${deletedMessageIndex} (ID string: ${deletedMessageIdString})`);
             const chatMetadata = ensureFavoritesArrayExists();
             if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) return;

             // Find if the *exact* messageId string exists in favorites
             const favIndex = chatMetadata.favorites.findIndex(fav => fav.messageId === deletedMessageIdString);

             if (favIndex !== -1) {
                 console.log(`${pluginName}: 消息 ${deletedMessageIdString} 被删除，移除对应的收藏项`);
                 chatMetadata.favorites.splice(favIndex, 1);
                 // Also need to update messageIds (indices) of subsequent favorites
                 chatMetadata.favorites.forEach(fav => {
                     const favIndexNum = parseInt(fav.messageId, 10);
                     if (!isNaN(favIndexNum) && favIndexNum > deletedMessageIndex) {
                         fav.messageId = String(favIndexNum - 1); // Decrement index
                     }
                 });

                 saveMetadataDebounced(); // Save changes

                 if (favoritesPopup && favoritesPopup.isVisible()) {
                     updateFavoritesPopup(); // Update popup if open
                 }
                 // No need to refresh icons here, MESSAGE_DELETED should trigger UI update
             } else {
                 console.log(`${pluginName}: 未找到引用已删除消息 ${deletedMessageIdString} 的收藏项`);
                 // It's still possible a later message's index needs updating
                 let changed = false;
                  chatMetadata.favorites.forEach(fav => {
                     const favIndexNum = parseInt(fav.messageId, 10);
                     if (!isNaN(favIndexNum) && favIndexNum > deletedMessageIndex) {
                         fav.messageId = String(favIndexNum - 1); // Decrement index
                         changed = true;
                     }
                 });
                 if (changed) {
                     saveMetadataDebounced();
                      if (favoritesPopup && favoritesPopup.isVisible()) {
                          updateFavoritesPopup(); // Update popup if open
                      }
                 }
             }
             // Refresh icons in view after potential index changes
             setTimeout(refreshFavoriteIconsInView, 100);
         });


        // Listener for when new messages appear (sent or received)
        const handleNewMessage = (msg) => {
             // msg object might contain the actual message data including its assigned index ('id')
             // or we might need to wait for DOM update
             setTimeout(() => {
                 addFavoriteIconsToMessages(); // Ensure new message gets an icon structure
                 // Don't need full refresh, new icon will be empty star
             }, 150);
        };
        eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);
        // Refresh icons when a message is updated (e.g., edited)
        eventSource.on(event_types.MESSAGE_UPDATED, () => {
             setTimeout(() => refreshFavoriteIconsInView(), 100);
        });


        // Listener for when more messages are loaded (scrolling up)
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
             console.log(`${pluginName}: 加载了更多消息，更新图标...`);
             setTimeout(() => {
                 addFavoriteIconsToMessages(); // Add icon structure to newly loaded messages
                 refreshFavoriteIconsInView(); // Refresh states of all visible icons
             }, 150);
        });

        // Optional: MutationObserver as a fallback (can be resource-intensive)
        /*
        const chatObserver = new MutationObserver((mutations) => {
            let needsUpdate = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        if (node.nodeType === 1 && ($(node).hasClass('mes') || $(node).find('.mes').length > 0)) {
                            needsUpdate = true;
                        }
                    });
                }
                // Also check if mesid attribute is added/changed
                if (mutation.type === 'attributes' && mutation.attributeName === 'mesid') {
                     needsUpdate = true;
                }
            }
            if (needsUpdate) {
                 // Debounce this call
                 clearTimeout(window.starZObserverTimeout);
                 window.starZObserverTimeout = setTimeout(() => {
                      console.log(`${pluginName}: MutationObserver detected changes, running updates...`);
                      addFavoriteIconsToMessages();
                      refreshFavoriteIconsInView();
                 }, 300); // Debounce time
            }
        });

        const chatElement = document.getElementById('chat');
        if (chatElement) {
            chatObserver.observe(chatElement, {
                childList: true,
                subtree: true,
                attributes: true, // Observe attribute changes like mesid
                attributeFilter: ['mesid'] // Only focus on mesid attribute
            });
             console.log(`${pluginName}: MutationObserver 已启动`);
        } else {
             console.error(`${pluginName}: 未找到 #chat 元素，无法启动 MutationObserver`);
        }
        */

        console.log(`${pluginName}: 插件加载完成!`);
    } catch (error) {
        console.error(`${pluginName}: 初始化过程中出错:`, error);
    }
});
