// === BOT SETUP / KEEP ALIVE ===
require('dotenv').config();
const express = require('express');
const app = express();
app.get('/', (req, res) => res.send('✅ Bot is online and running!'));
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`🌐 Keep-alive server running on port ${PORT}`));

const {
    Client,
    GatewayIntentBits,
    ActionRowBuilder,
    ButtonBuilder,
    ButtonStyle,
    StringSelectMenuBuilder,
    ModalBuilder,
    TextInputBuilder,
    TextInputStyle,
    EmbedBuilder,
    ChannelType,
    Events
} = require('discord.js');

// === BOT CLIENT ===
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers
    ]
});

// === CONFIG ===
const ADMIN_CHANNEL_ID = '1430039834835025920';     // Admin review channel (where staff sees submissions)
const VERIFICATION_LOG_ID = '1342342913585053705';  // Verification log channel (accepted entries go here)
const STAFF_LOG_CHANNEL_ID = '1358627364132884690'; // Staff action log
const VERIFIED_ROLE_IDS = ['1358619270472401031', '1369025309600518255']; // Roles to add on approval
const GESTURES = ["peace sign ✌️", "thumbs up 👍", "hold up 3 fingers 🤟", "point to the ceiling ☝️", "make a heart with your hands ❤️"];

// In-memory maps
const userActiveTicket = new Map();      // userId -> tempChannel
const adminSubmissionMap = new Map();    // userId -> { channelId, messageId }

// === READY EVENT ===
client.once(Events.ClientReady, () => {
    console.log(`✅ Logged in as ${client.user.tag}`);
});

// === HELPERS ===
async function safeFetchChannel(guild, id) {
    try { return await guild.channels.fetch(id); } 
    catch { return null; }
}

async function safeDeleteMessage(channel, messageId) {
    try {
        if (!channel) return;
        const msg = await channel.messages.fetch(messageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
    } catch { /* ignore */ }
}

// === UI COMPONENTS ===
class VerifyButton {
    static create() {
        return new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('start_verify')
                .setLabel('✅ Start Verification')
                .setStyle(ButtonStyle.Primary)
        );
    }
}

class VerificationSelect {
    static create() {
        return new ActionRowBuilder().addComponents(
            new StringSelectMenuBuilder()
                .setCustomId('verification_type')
                .setPlaceholder('Choose verification method...')
                .addOptions([
                    { label: 'ID Verification', description: 'Submit ID and gesture video', value: 'id' },
                    { label: 'Cross Verification', description: 'Screenshot from trusted server', value: 'cross' },
                    { label: 'Vouch Verification', description: 'Trusted member vouch', value: 'vouch' }
                ])
        );
    }
}

// === SETUP COMMAND ===
client.on(Events.MessageCreate, async message => {
    if (message.content === '!setupverify' && message.member.permissions.has('Administrator')) {
        await message.channel.send({
            embeds: [{ title: '🔰 Verification System', description: 'Click below to start verification.', color: 0x00BFFF }],
            components: [VerifyButton.create()]
        });
        await message.delete().catch(() => {});
    }
});

// === INTERACTIONS ===
client.on(Events.InteractionCreate, async interaction => {
    try {
        // ----- BUTTONS -----
        if (interaction.isButton()) {

            // START VERIFICATION
            if (interaction.customId === 'start_verify') {
                if (userActiveTicket.has(interaction.user.id)) {
                    return await interaction.reply({ content: '❌ You already have an active verification ticket.', ephemeral: true });
                }
                return await interaction.reply({ content: 'Select your verification method:', components: [VerificationSelect.create()], ephemeral: true });
            }

            // UPLOAD FILES
            if (interaction.customId === 'upload_files') {
                const tempChannel = userActiveTicket.get(interaction.user.id);
                if (!tempChannel || !tempChannel.filesCollected || tempChannel.filesCollected.length === 0) {
                    return await interaction.reply({ content: '❌ Please upload files before pressing Upload.', ephemeral: true });
                }

                const adminChannel = await safeFetchChannel(interaction.guild, ADMIN_CHANNEL_ID);
                if (!adminChannel) return await interaction.reply({ content: '⚠️ Admin review channel not found.', ephemeral: true });

                const files = tempChannel.filesCollected.map(att => att.attachment || att.url);

                // Send submission to admin channel
                const adminMsg = await adminChannel.send({
                    content: `<@${interaction.user.id}> submitted verification files:`,
                    files: files,
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`approve_${interaction.user.id}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`deny_${interaction.user.id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger)
                    )]
                });

                adminSubmissionMap.set(interaction.user.id, { channelId: adminChannel.id, messageId: adminMsg.id });

                await interaction.reply({ content: '✅ Submission sent to staff. The temp channel will self-destruct in 1 minute.', ephemeral: true });

                setTimeout(async () => {
                    if (userActiveTicket.has(interaction.user.id)) {
                        await tempChannel.delete().catch(() => {});
                        userActiveTicket.delete(interaction.user.id);
                    }
                }, 60_000);

                return;
            }

            // CLOSE TICKET
            if (interaction.customId === 'close_ticket') {
                const tempChannel = userActiveTicket.get(interaction.user.id);
                if (tempChannel) {
                    await tempChannel.delete().catch(() => {});
                    userActiveTicket.delete(interaction.user.id);
                    return await interaction.reply({ content: '✅ Your verification ticket has been closed.', ephemeral: true });
                } else {
                    return await interaction.reply({ content: '❌ No active ticket to close.', ephemeral: true });
                }
            }

            // VOUCH MODAL
            if (interaction.customId === 'vouch_modal') {
                const modal = new ModalBuilder()
                    .setCustomId('vouch_submit') // modal id
                    .setTitle('Submit Vouch');

                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('vouch_name')
                        .setLabel('Trusted Member Name')
                        .setStyle(TextInputStyle.Short)
                        .setRequired(true)
                ));
                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('vouch_text')
                        .setLabel('Why they vouch (details)')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                ));

                return await interaction.showModal(modal);
            }

            // STAFF MODAL: Approve / Deny
            if (interaction.customId.startsWith('approve_') || interaction.customId.startsWith('deny_')) {
                const isApprove = interaction.customId.startsWith('approve_');
                const targetUserId = interaction.customId.split('_')[1];

                const modal = new ModalBuilder()
                    .setCustomId(`${isApprove ? 'approve_modal_' : 'deny_modal_'}${targetUserId}`)
                    .setTitle(isApprove ? 'Approve Submission' : 'Deny Submission');

                modal.addComponents(new ActionRowBuilder().addComponents(
                    new TextInputBuilder()
                        .setCustomId('staff_text')
                        .setLabel(isApprove ? 'Enter text to log' : 'Enter deny reason')
                        .setStyle(TextInputStyle.Paragraph)
                        .setRequired(true)
                ));

                return await interaction.showModal(modal);
            }
        }

        // ----- SELECT MENU -----
        if (interaction.isStringSelectMenu() && interaction.customId === 'verification_type') {
            const choice = interaction.values[0];
            const member = interaction.user;
            const guild = interaction.guild;

            if (userActiveTicket.has(member.id)) {
                return await interaction.reply({ content: '❌ You already have an active verification ticket.', ephemeral: true });
            }

            const channel = await guild.channels.create({
                name: `verify-${member.username}`,
                type: ChannelType.GuildText,
                permissionOverwrites: [
                    { id: guild.id, deny: ['ViewChannel'] },
                    { id: member.id, allow: ['ViewChannel', 'SendMessages', 'AttachFiles', 'ReadMessageHistory'] },
                    { id: client.user.id, allow: ['ViewChannel', 'SendMessages', 'ManageChannels', 'ReadMessageHistory'] }
                ]
            });

            channel.filesCollected = [];
            userActiveTicket.set(member.id, channel);

            let msgContent = '';
            let actionButtons = [];

            switch (choice) {
                case 'id':
                    msgContent = `🪪 **ID Verification**\nUpload your ID photos and short gesture video.\nPress **Upload** once all files have been fully sent.`;
                    actionButtons.push(new ButtonBuilder().setCustomId('upload_files').setLabel('Upload').setStyle(ButtonStyle.Primary));
                    break;
                case 'cross':
                    msgContent = `🔄 **Cross Verification**\nUpload your screenshot showing a verified role from a trusted server.\nPress **Upload** once files are fully sent.`;
                    actionButtons.push(new ButtonBuilder().setCustomId('upload_files').setLabel('Upload').setStyle(ButtonStyle.Primary));
                    break;
                case 'vouch':
                    msgContent = `🗣️ **Vouch Verification**\nClick below to submit a vouch via modal.`;
                    actionButtons.push(new ButtonBuilder().setCustomId('vouch_modal').setLabel('Submit Vouch').setStyle(ButtonStyle.Primary));
                    break;
            }

            // Close Ticket button
            actionButtons.push(new ButtonBuilder().setCustomId('close_ticket').setLabel('Close Ticket').setStyle(ButtonStyle.Secondary));

            await interaction.reply({ content: `✅ Verification channel created: ${channel}`, ephemeral: true });
            await channel.send({ content: msgContent, components: [new ActionRowBuilder().addComponents(actionButtons)] });

            // Auto-delete after 5 min if no submission
            setTimeout(async () => {
                if (userActiveTicket.has(member.id)) {
                    const tmp = userActiveTicket.get(member.id);
                    await tmp.send('❌ No submission received — closing verification channel.').catch(() => {});
                    await tmp.delete().catch(() => {});
                    userActiveTicket.delete(member.id);

                    const admin = await safeFetchChannel(interaction.guild, ADMIN_CHANNEL_ID);
                    if (admin) await admin.send(`❌ <@${member.id}> opened a verification ticket but submitted nothing.`).catch(() => {});
                }
            }, 300_000);

            return;
        }

        // ----- MODAL SUBMISSIONS -----
        if (interaction.isModalSubmit()) {
            const cid = interaction.customId;

            // === VOUCH SUBMIT ===
            if (cid === 'vouch_submit') {
                const name = interaction.fields.getTextInputValue('vouch_name');
                const vouchText = interaction.fields.getTextInputValue('vouch_text');
                const member = interaction.user;
                const adminChannel = await safeFetchChannel(interaction.guild, ADMIN_CHANNEL_ID);
                if (!adminChannel) {
                    return await interaction.reply({ content: '⚠️ Admin channel not found.', ephemeral: true });
                }

                const embed = new EmbedBuilder()
                    .setTitle('🗣️ New Vouch Submission')
                    .addFields([{ name: 'User', value: `<@${member.id}> (${name})` }, { name: 'Vouch', value: vouchText }])
                    .setTimestamp();

                const adminMsg = await adminChannel.send({
                    embeds: [embed],
                    components: [new ActionRowBuilder().addComponents(
                        new ButtonBuilder().setCustomId(`approve_${member.id}`).setLabel('✅ Approve').setStyle(ButtonStyle.Success),
                        new ButtonBuilder().setCustomId(`deny_${member.id}`).setLabel('❌ Deny').setStyle(ButtonStyle.Danger)
                    )]
                });

                adminSubmissionMap.set(member.id, { channelId: adminChannel.id, messageId: adminMsg.id });

                await interaction.reply({ content: '✅ Your vouch was submitted to staff. The temp channel will self-destruct in 1 minute.', ephemeral: true });

                setTimeout(async () => {
                    if (userActiveTicket.has(member.id)) {
                        const c = userActiveTicket.get(member.id);
                        await c.delete().catch(() => {});
                        userActiveTicket.delete(member.id);
                    }
                }, 60_000);

                return;
            }

            // === STAFF APPROVE / DENY ===
            if (cid.startsWith('approve_modal_') || cid.startsWith('deny_modal_')) {
                const isApprove = cid.startsWith('approve_modal_');
                const memberId = cid.split('_')[2];
                const staff = interaction.user;
                const staffText = interaction.fields.getTextInputValue('staff_text');

                const member = await interaction.guild.members.fetch(memberId).catch(() => null);
                if (!member) return await interaction.reply({ content: '⚠️ Target user not found.', ephemeral: true });

                if (isApprove) {
                    for (const roleId of VERIFIED_ROLE_IDS) {
                        try { await member.roles.add(roleId); } catch {}
                    }
                    const logChannel = await safeFetchChannel(interaction.guild, VERIFICATION_LOG_ID);
                    if (logChannel) await logChannel.send(`✅ Verified <@${member.id}> | Info: ${staffText}`).catch(() => {});
                } else {
                    await member.send(`❌ Your verification was denied.\nReason: ${staffText}`).catch(() => {});
                }

                const staffLog = await safeFetchChannel(interaction.guild, STAFF_LOG_CHANNEL_ID);
                if (staffLog) {
                    await staffLog.send(`${isApprove ? '✅ Approved' : '❌ Denied'} by <@${staff.id}> for <@${member.id}> | ${staffText}`).catch(() => {});
                }

                // --- INSTANT CLEANUP ---
                const submissionInfo = adminSubmissionMap.get(memberId);
                if (submissionInfo) {
                    const adminChannel = await safeFetchChannel(interaction.guild, submissionInfo.channelId);
                    await safeDeleteMessage(adminChannel, submissionInfo.messageId);
                    adminSubmissionMap.delete(memberId);
                }

                if (userActiveTicket.has(memberId)) {
                    const tmp = userActiveTicket.get(memberId);
                    await tmp.delete().catch(() => {});
                    userActiveTicket.delete(memberId);
                }

                return await interaction.reply({ content: `✅ Submission ${isApprove ? 'approved' : 'denied'} and cleaned up.`, ephemeral: true });
            }
        }

    } catch (err) {
        console.error('Interaction error:', err);
        if (interaction && !interaction.replied) {
            await interaction.reply({ content: '⚠️ An error occurred. Please try again later.', ephemeral: true }).catch(() => {});
        }
    }
});

// === MESSAGE ATTACHMENTS RECORDING ===
client.on(Events.MessageCreate, async message => {
    if (message.author.bot) return;
    if (!userActiveTicket.has(message.author.id)) return;

    const tempChannel = userActiveTicket.get(message.author.id);
    if (!tempChannel) return;

    if (message.attachments.size > 0) {
        tempChannel.filesCollected = tempChannel.filesCollected || [];
        for (const att of message.attachments.values()) {
            tempChannel.filesCollected.push(att);
        }
    }
});
