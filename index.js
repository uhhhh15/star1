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

    // Update the popup if it's open
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

    const messageIndex = parseInt(messageIdString, 10);
    if (isNaN(messageIndex)) {
        console.error(`${pluginName}: handleFavoriteToggle - 退出：mesid 解析为 NaN: ${messageIdString}`);
        // 注意：这里之前直接 return 了，但 messageIdString 本身可能就是有效的标识符
        // 现在改为继续尝试使用 messageIdString，而不是仅依赖解析后的索引
        // return;
    }

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

    // 尝试通过 mesid 字符串或数字索引查找消息
    const message = context.chat.find((msg, index) => String($(msg).attr?.('mesid')) === messageIdString || String(index) === messageIdString);

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
            messageId: messageIdString, // 使用原始 mesid 字符串
            sender: message.name,
            role: message.is_user ? 'user' : 'character',
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
        const extraButtonsContainer = messageElement.find('.extraMesButtons');
        if (extraButtonsContainer.length && !extraButtonsContainer.find('.favorite-toggle-icon').length) {
            extraButtonsContainer.append(messageButtonHtml);
            // console.log(`${pluginName}: Added favorite icon to message ${messageElement.attr('mesid')}`); // 可以取消注释以调试
        }
    });
}

/**
 * Updates all favorite icons in the current view to reflect current state
 */
function refreshFavoriteIconsInView() {
    const chatMetadata = ensureFavoritesArrayExists();
    // 如果无法获取元数据，或者元数据中没有 favorites 数组，则退出
    if (!chatMetadata || !Array.isArray(chatMetadata.favorites)) {
        console.warn(`${pluginName}: refreshFavoriteIconsInView - 无法获取有效的 chatMetadata 或 favorites 数组`);
        // 即使没有收藏，也要确保图标是空心状态
        $('#chat').find('.favorite-toggle-icon i').removeClass('fa-solid').addClass('fa-regular');
        return;
    }

    // 确保所有消息都有图标结构
    addFavoriteIconsToMessages();

    // 更新图标状态
    $('#chat').find('.mes').each(function() {
        const messageElement = $(this);
        const messageId = messageElement.attr('mesid'); // 获取 mesid 字符串

        if (messageId) {
            // 使用 chatMetadata.favorites 进行检查 (对比 messageId 字符串)
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
 * @param {number} index Index of the item (used for pagination)
 * @returns {string} HTML string for the favorite item
 */
function renderFavoriteItem(favItem, index) {
    // 使用 favItem.messageId (mesid 字符串) 来查找消息
    if (!favItem) return '';

    const context = getContext();
    let message = null;
    if (context.chat && Array.isArray(context.chat)) {
         // 查找 mesid 属性匹配 favItem.messageId 的消息
         message = context.chat.find(msg => String($(msg).attr?.('mesid')) === String(favItem.messageId));
         // 如果找不到，尝试用消息索引作为 messageId 来查找 (兼容旧数据或特殊情况)
         if (!message) {
             const messageIndex = parseInt(favItem.messageId, 10);
             if (!isNaN(messageIndex) && context.chat[messageIndex]) {
                 message = context.chat[messageIndex];
             }
         }
         // 最终回退，尝试按 msg.id 查找（如果存在的话）
         if (!message) {
             message = context.chat.find(msg => String(msg.id) === String(favItem.messageId));
         }
    }


    let previewText = '';
    let deletedClass = '';

    if (message && message.mes) { // 增加对 message.mes 的检查
        // 使用 messageFormatting 创建文本预览（可能截断）
        try {
             // 先获取完整文本
             let fullText = message.mes;
             // 手动截断以生成摘要预览，保留原始格式化逻辑
             if (fullText.length > 100) {
                 fullText = fullText.substring(0, 100) + '...';
             }
             previewText = messageFormatting(fullText, favItem.sender, false,
                                            favItem.role === 'user', null, {}, false);
        } catch (e) {
             console.error(`${pluginName}: Error formatting message preview:`, e);
             // Fallback to truncated plain text if formatting fails
             previewText = message.mes.substring(0, 100) + (message.mes.length > 100 ? '...' : '');
        }
    } else {
        previewText = '[消息内容不可用或已删除]'; // 更清晰的提示
        deletedClass = 'deleted';
    }

    // 返回的 HTML 结构中，在 fav-actions div 内添加预览按钮
    return `
        <div class="favorite-item" data-fav-id="${favItem.id}" data-msg-id="${favItem.messageId}" data-index="${index}">
            <div class="fav-meta">${favItem.sender} (${favItem.role})</div>
            <div class="fav-note" style="${favItem.note ? '' : 'display:none;'}">备注：${favItem.note || ''}</div>
            {/* 这个 div 显示格式化后的截断预览 */}
            <div class="fav-preview ${deletedClass}">${previewText}</div>
            <div class="fav-actions">
                <i class="fa-solid fa-eye preview-fav" title="预览上下文"></i> {/* 新增预览按钮 */}
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
    // 确保 context 和相关属性存在
    const chatName = context?.characterId
        ? context.name2
        : `群组: ${context?.groups?.find(g => g.id === context.groupId)?.name || '未命名群组'}`;
    const totalFavorites = chatMetadata.favorites ? chatMetadata.favorites.length : 0;
    // 按 messageId (字符串，但内容是数字) 降序排序
    const sortedFavorites = chatMetadata.favorites ? [...chatMetadata.favorites].sort((a, b) => parseInt(b.messageId) - parseInt(a.messageId)) : [];

    const totalPages = Math.max(1, Math.ceil(totalFavorites / itemsPerPage));
    if (currentPage > totalPages) currentPage = totalPages;
    const startIndex = (currentPage - 1) * itemsPerPage;
    const endIndex = Math.min(startIndex + itemsPerPage, totalFavorites);
    const currentPageItems = sortedFavorites.slice(startIndex, endIndex);

    let contentHtml = `
        <div id="favorites-popup-content">
            <div class="favorites-header">
                <h3>${chatName} - ${totalFavorites} 条收藏</h3>
            </div>
            <div class="favorites-divider"></div>
            <div class="favorites-list">
    `;

    if (totalFavorites === 0) {
        contentHtml += `<div class="favorites-empty">当前没有收藏的消息。点击消息右下角的星形图标来添加收藏。</div>`;
    } else {
        currentPageItems.forEach((favItem, index) => {
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
        favoritesPopup.content.innerHTML = contentHtml; // 直接修改 DOM 元素的 innerHTML
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
                '<div class="spinner"></div>', // Initial content while loading
                POPUP_TYPE.TEXT,
                '',
                {
                    title: '收藏管理',
                    wide: true,
                    okButton: false,
                    cancelButton: false,
                    allowVerticalScrolling: true // Keep vertical scrolling
                }
            );

            console.log(`${pluginName}: Popup instance created successfully.`);

            // Attach event listener to the popup's content container
            $(favoritesPopup.content).on('click', function(event) {
                const target = $(event.target);

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
                // Handle edit note (pencil icon)
                else if (target.hasClass('fa-pencil')) {
                    const favItem = target.closest('.favorite-item');
                    if (favItem && favItem.length) {
                         const favId = favItem.data('fav-id');
                         handleEditNote(favId);
                    } else {
                         console.warn(`${pluginName}: Clicked edit icon, but couldn't find parent .favorite-item`);
                    }
                }
                // Handle delete favorite (trash icon)
                else if (target.hasClass('fa-trash')) {
                    const favItem = target.closest('.favorite-item');
                    if (favItem && favItem.length) {
                        const favId = favItem.data('fav-id');
                        const msgId = favItem.data('msg-id');
                        handleDeleteFavoriteFromPopup(favId, msgId);
                    } else {
                         console.warn(`${pluginName}: Clicked delete icon, but couldn't find parent .favorite-item`);
                    }
                }
                // *** NEW: Handle preview context (eye icon) ***
                else if (target.hasClass('preview-fav')) {
                    const favItem = target.closest('.favorite-item');
                    if (favItem && favItem.length) {
                        const msgId = favItem.data('msg-id'); // Get messageId (mesid string)
                        console.log(`${pluginName}: Preview context requested for msgId: ${msgId}`);
                        handlePreviewFavoriteContext(msgId); // Call the new handler function
                    } else {
                         console.warn(`${pluginName}: Clicked preview icon, but couldn't find parent .favorite-item`);
                    }
                }
            });

        } catch (error) {
            console.error(`${pluginName}: Failed during popup creation or event listener setup:`, error);
            favoritesPopup = null; // Reset on failure
            return;
        }
    } else {
         console.log(`${pluginName}: Reusing existing popup instance.`);
    }

    currentPage = 1;
    updateFavoritesPopup(); // Update content immediately

    if (favoritesPopup && !favoritesPopup.isVisible()) { // Only show if not already visible
        try {
            favoritesPopup.show();
        } catch(showError) {
             console.error(`${pluginName}: Error showing popup:`, showError);
             // Optionally reset popup if show fails critically
             // favoritesPopup = null;
        }
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

    // Find the index of the target message using its mesid string
    const targetIndex = context.chat.findIndex(msg => String($(msg).attr?.('mesid')) === targetMessageId);

    if (targetIndex === -1) {
        console.error(`${pluginName}: handlePreviewFavoriteContext - Message with mesid ${targetMessageId} not found in chat array.`);
        // Try finding by index if targetMessageId happens to be the index (less likely but for robustness)
        const numericId = parseInt(targetMessageId, 10);
        if (!isNaN(numericId) && context.chat[numericId]) {
             console.log(`${pluginName}: handlePreviewFavoriteContext - Found message by index ${numericId} as fallback.`);
             // If found by index, we proceed with numericId as targetIndex
             // This case is less likely if mesid is always used
             // Re-assign targetIndex for clarity if needed, or just use numericId directly below
             // targetIndex = numericId; // Let's assume mesid is the primary identifier
             await callGenericPopup(`在当前聊天中未直接找到消息ID ${targetMessageId}，请检查数据一致性。`, POPUP_TYPE.WARNING);
             return; // Exit if primary lookup failed
        } else {
            await callGenericPopup(`在当前聊天中未找到原始消息 (ID: ${targetMessageId})。`, POPUP_TYPE.WARNING);
            return;
        }
    }

    console.log(`${pluginName}: handlePreviewFavoriteContext - Found target message at index: ${targetIndex}`);

    // Gather messages: previous, target, next
    const messagesToPreview = [];
    if (targetIndex > 0) {
        messagesToPreview.push(context.chat[targetIndex - 1]);
    } else {
        messagesToPreview.push(null); // Placeholder for alignment if needed, or omit
    }
    messagesToPreview.push(context.chat[targetIndex]); // The target message
    if (targetIndex < context.chat.length - 1) {
        messagesToPreview.push(context.chat[targetIndex + 1]);
    } else {
        messagesToPreview.push(null); // Placeholder
    }

    // Filter out null placeholders if any were added
    const validMessages = messagesToPreview.filter(msg => msg !== null);
    console.log(`${pluginName}: handlePreviewFavoriteContext - Messages to preview (count: ${validMessages.length}):`, validMessages);


    // Open new tab
    const previewWindow = window.open('', '_blank');
    if (!previewWindow) {
        await callGenericPopup('无法打开新标签页。请检查您的弹出窗口拦截器设置。', POPUP_TYPE.ERROR);
        return;
    }

    // Construct HTML for the new tab
    // *** IMPORTANT: VERIFY THESE CSS PATHS FOR YOUR SILLYTAVERN INSTALLATION ***
    const cssPaths = [
        'css/style.css',          // Main ST styles
        'css/themes.css',         // Theme definitions
        'css/font-awesome/css/all.min.css', // Font Awesome icons
        // Add the path to your *currently active* theme CSS if possible and known
        // e.g., 'css/themes/your-active-theme.css' - this might be hard to get dynamically
        // Alternatively, rely on themes.css and the classes it applies based on body attributes
    ];
    // Generate links relative to the root of the SillyTavern instance
    let cssLinks = cssPaths.map(path => `<link rel="stylesheet" href="/${path}">`).join('\n    ');

    // Basic fallback styles if external CSS fails to load
    const fallbackStyles = `
        body { background-color: #2c2f33; color: #cccccc; font-family: 'Arial', sans-serif; padding: 15px; line-height: 1.6; }
        .mes_container { max-width: 900px; margin: 20px auto; border: 1px solid #444; border-radius: 8px; background-color: #23272a; padding: 15px; box-shadow: 0 2px 5px rgba(0,0,0,0.2); }
        h2, p { color: #ffffff; text-align: center; }
        hr { border: 0; height: 1px; background-color: #444; margin: 20px 0; }
        .mes { display: flex; margin-bottom: 15px; align-items: flex-start; }
        .avatar { flex-shrink: 0; margin-right: 12px; }
        .avatar img { width: 45px; height: 45px; border-radius: 50%; border: 1px solid #555; }
        .mes_inner { background-color: #36393f; border-radius: 8px; padding: 10px 15px; flex-grow: 1; box-shadow: 0 1px 3px rgba(0,0,0,0.1); overflow: hidden; } /* Added overflow */
        .mes_name { font-weight: bold; margin-bottom: 5px; color: #99aab5; font-size: 0.9em; }
        .mes_text { color: #dcddde; word-wrap: break-word; white-space: pre-wrap; font-size: 1em; }
        /* Try to mimic user/char distinction */
        .char_mes .mes_name { color: #7289da; } /* Example color */
        .user_mes { flex-direction: row-reverse; } /* User message on the right */
        .user_mes .avatar { margin-right: 0; margin-left: 12px; }
        .user_mes .mes_inner { background-color: #4f545c; }
        .user_mes .mes_name { text-align: right; }
        .system_mes .mes_inner { background-color: rgba(255, 193, 7, 0.1); border-left: 3px solid #ffc107; font-style: italic; color: #ffebae; }
        .system_mes .mes_name { color: #ffc107; }
        /* Target the specific message */
        .target-message .mes_inner { border: 2px solid #ffcc00; /* Highlight */ }
    `;

    // Determine current theme class for body (best effort)
    const themeClass = $('body').attr('class') || ''; // Get classes from main body

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
<body class="${themeClass}"> {/* Apply theme class if found */}
    <div class="mes_container">
        <h2>消息上下文预览</h2>
        <p><i>这是收藏的消息 (ID: ${targetMessageId}) 及其相邻消息的快照。外观取决于样式表的加载情况。</i></p>
        <hr>
`;

        validMessages.forEach(msg => {
            if (!msg) return; // Should already be filtered, but double-check

            const msgId = String($(msg).attr?.('mesid')); // Get the message ID for highlighting
            const isUser = msg.is_user;
            const isSystem = msg.is_system; // Check for system message flag
            const senderName = msg.name || (isUser ? 'User' : (isSystem ? 'System' : 'Character'));
            // *** IMPORTANT: Verify these avatar paths ***
            const defaultUserAvatar = '/img/user-default.png';
            const defaultCharAvatar = '/img/character-default.png'; // Assuming a generic char default exists
            const avatarSrc = msg.avatar || (isUser ? defaultUserAvatar : (msg.pic || defaultCharAvatar)); // Use character pic if available, else default

            // Use the raw 'mes' content directly. The browser will render the HTML within.
            const mesContent = msg.mes || '[空消息]';

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
                <div class="avatar">
                    <img src="${avatarSrc}" alt="${senderName}" onerror="this.style.display='none'"> {/* Hide if image fails */}
                </div>
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
        previewWindow.document.open();
        previewWindow.document.write(previewHtml);
        previewWindow.document.close();
        console.log(`${pluginName}: handlePreviewFavoriteContext - Preview tab content written.`);
        previewWindow.focus(); // Bring the new tab to the front
    }


/**
 * Handles the deletion of a favorite from the popup
 * @param {string} favId The favorite ID
 * @param {string} messageId The message ID (mesid string)
 */
async function handleDeleteFavoriteFromPopup(favId, messageId) {
    const confirmResult = await callGenericPopup('确定要删除这条收藏吗？', POPUP_TYPE.CONFIRM);

    if (confirmResult === POPUP_RESULT.YES) {
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

    // Check if the user confirmed (result is not null and not explicitly cancelled)
    // Note: POPUP_RESULT.CANCELLED might vary based on popup implementation, null check is safer
    if (result !== null) { // Allow empty string as a valid note
        updateFavoriteNote(favId, result); // This function handles saving
        updateFavoritesPopup(); // Update the popup list to show the new note
    }
}


/**
 * Clears invalid favorites (those referencing deleted messages)
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

    const invalidFavoritesIds = []; // Store IDs of invalid favorites
    const validFavorites = [];    // Store valid favorite items

    // Create a set of existing message IDs (mesid strings) for quick lookup
    const existingMessageIds = new Set();
    context.chat.forEach(msg => {
        const mesid = $(msg).attr?.('mesid');
        if (mesid) {
            existingMessageIds.add(String(mesid));
        }
        // Also consider msg.id if it's used sometimes
        if (msg.id) {
             existingMessageIds.add(String(msg.id));
        }
    });

    chatMetadata.favorites.forEach(fav => {
        // Check if the favorite's messageId exists in the set of current message IDs
        if (existingMessageIds.has(String(fav.messageId))) {
            validFavorites.push(fav); // Keep valid favorite
        } else {
            invalidFavoritesIds.push(fav.id); // Mark favorite ID as invalid
            console.log(`${pluginName}: Found invalid favorite referencing messageId: ${fav.messageId}`);
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
        saveMetadataDebounced(); // Save the changes

        await callGenericPopup(`已成功清理 ${invalidFavoritesIds.length} 条无效收藏。`, POPUP_TYPE.TEXT);
        updateFavoritesPopup(); // Update the popup display
        refreshFavoriteIconsInView(); // Refresh icons in chat in case any were for deleted items
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

            $('#favorites_button').on('click', () => {
                showFavoritesPopup();
            });
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 input_button.html 失败:`, error);
        }

        // Add settings to extension settings area
        try {
            const settingsHtml = await renderExtensionTemplateAsync(`third-party/${pluginName}`, 'settings_display');
            $('#extensions_settings').append(settingsHtml); // Append to the general extensions settings container
            console.log(`${pluginName}: 已将设置 UI 添加到 #extensions_settings`);
        } catch (error) {
            console.error(`${pluginName}: 加载或注入 settings_display.html 失败:`, error);
        }

        // Set up event delegation for favorite toggle icon clicks on the document
        $(document).on('click', '.favorite-toggle-icon', handleFavoriteToggle);

        // Initialize favorites array for the current chat when the plugin loads
        ensureFavoritesArrayExists(); // Attempt initialization

        // Initial UI setup: Add icons to existing messages and set their correct state
        addFavoriteIconsToMessages();
        refreshFavoriteIconsInView();

        // --- Event Listeners ---
        eventSource.on(event_types.CHAT_CHANGED, () => {
            console.log(`${pluginName}: 聊天已更改，更新收藏图标...`);
            ensureFavoritesArrayExists(); // Ensure the array exists for the new chat
            setTimeout(() => {
                addFavoriteIconsToMessages(); // Add icons structure to potentially new messages
                refreshFavoriteIconsInView(); // Update all icons based on the new chat's metadata
            }, 150); // Slightly longer delay for chat changes
        });

        eventSource.on(event_types.MESSAGE_DELETED, (deletedMessageData) => {
            // deletedMessageData might be index or { index: number, id: string }
            // We need the mesid string if available, otherwise the index as string
            let deletedMessageId = null;
            if (typeof deletedMessageData === 'object' && deletedMessageData.id) {
                deletedMessageId = String(deletedMessageData.id); // Prefer the mesid if provided
            } else if (typeof deletedMessageData === 'number') {
                deletedMessageId = String(deletedMessageData); // Fallback to index as string
            }

            if (!deletedMessageId) {
                 console.warn(`${pluginName}: Received MESSAGE_DELETED event with unclear data:`, deletedMessageData);
                 return;
            }

            console.log(`${pluginName}: 检测到消息删除事件, ID/Index: ${deletedMessageId}`);
            const chatMetadata = ensureFavoritesArrayExists();
            if (!chatMetadata || !Array.isArray(chatMetadata.favorites) || !chatMetadata.favorites.length) return;

            // Find if any favorite references this messageId (mesid string)
            const favIndex = chatMetadata.favorites.findIndex(fav => fav.messageId === deletedMessageId);

            if (favIndex !== -1) {
                console.log(`${pluginName}: 消息 ${deletedMessageId} 被删除，移除对应的收藏项`);
                chatMetadata.favorites.splice(favIndex, 1);
                saveMetadataDebounced(); // Save changes

                // Update the popup if it's open
                if (favoritesPopup && favoritesPopup.isVisible()) {
                    updateFavoritesPopup();
                }
            } else {
                 console.log(`${pluginName}: 未找到引用已删除消息 ${deletedMessageId} 的收藏项`);
            }
        });

        // Listener for when new messages appear (sent or received)
        const handleNewMessage = (messageData) => { // messageData might contain info about the new message
             setTimeout(() => {
                 addFavoriteIconsToMessages(); // Ensure new messages get the icon structure
                 // refreshFavoriteIconsInView(); // Usually not needed, new icon defaults to off
                 // Optionally, if messageData provides the ID, target just that one:
                 if (typeof messageData === 'object' && messageData.id) {
                      const newMessageElement = $(`#chat .mes[mesid="${messageData.id}"]`);
                      if (newMessageElement.length && !newMessageElement.find('.favorite-toggle-icon').length) {
                           const extraButtonsContainer = newMessageElement.find('.extraMesButtons');
                           if(extraButtonsContainer.length) {
                               extraButtonsContainer.append(messageButtonHtml);
                           }
                      }
                 }
             }, 100); // Delay to allow DOM update
        };
        eventSource.on(event_types.MESSAGE_RECEIVED, handleNewMessage);
        eventSource.on(event_types.MESSAGE_SENT, handleNewMessage);
        eventSource.on(event_types.MESSAGE_UPDATED, (updateData) => { // Refresh state when message content/metadata changes
            console.log(`${pluginName}: Message updated event detected.`);
             setTimeout(() => refreshFavoriteIconsInView(), 150); // Refresh all icons might be safest
        });


        // Listener for when more messages are loaded (scrolling up)
        eventSource.on(event_types.MORE_MESSAGES_LOADED, () => {
             console.log(`${pluginName}: 加载了更多消息，更新图标...`);
             setTimeout(() => {
                 addFavoriteIconsToMessages(); // Add icon structure to newly loaded messages
                 refreshFavoriteIconsInView(); // Refresh the state of all visible icons
             }, 150); // Allow time for messages to render
        });

        // MutationObserver remains a good fallback for dynamic changes not caught by events
        const chatObserver = new MutationObserver((mutations) => {
            let needsIconAddition = false;
            for (const mutation of mutations) {
                if (mutation.type === 'childList' && mutation.addedNodes.length) {
                    mutation.addedNodes.forEach(node => {
                        // Check if the added node is a message or contains messages
                        if (node.nodeType === 1) { // Check if it's an element node
                            if ($(node).hasClass('mes') || $(node).find('.mes').length > 0) {
                                needsIconAddition = true;
                            }
                        }
                    });
                }
                // Optional: Check if attributes changed on a .mes element (might affect mesid)
                // if (mutation.type === 'attributes' && $(mutation.target).hasClass('mes')) {
                //     needsIconRefresh = true; // Might need refresh, not just addition
                // }
            }
            if (needsIconAddition) {
                 // Use debounce or throttle if this fires too often
                 setTimeout(() => {
                     console.log(`${pluginName}: MutationObserver detected added messages, adding icons...`);
                     addFavoriteIconsToMessages();
                     // Optionally refresh icons too, if needed
                     // refreshFavoriteIconsInView();
                 }, 200); // Longer delay for mutation observer
            }
        });

        const chatElement = document.getElementById('chat');
        if (chatElement) {
            chatObserver.observe(chatElement, {
                childList: true, // Observe direct children additions/removals
                subtree: true    // Observe additions/removals in descendants as well
                // attributes: true, // Optionally observe attribute changes (e.g., mesid)
                // attributeFilter: ['mesid'] // Filter attributes if observing them
            });
             console.log(`${pluginName}: MutationObserver 已启动，监视 #chat 的变化`);
        } else {
             console.error(`${pluginName}: 未找到 #chat 元素，无法启动 MutationObserver`);
        }


        console.log(`${pluginName}: 插件加载完成!`);
    } catch (error) {
        console.error(`${pluginName}: 初始化过程中出错:`, error);
    }
});
