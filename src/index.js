const {
  Client,
  GatewayIntentBits,
  Partials,
  PermissionFlagsBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ChannelType
} = require('discord.js');
const dotenv = require('dotenv');
const app = require('./server');

dotenv.config();

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.GuildMember]
});

const PORT = Number(process.env.PORT || 3000);
const VERIFICATION_GUILD_ID = process.env.VERIFICATION_GUILD_ID || process.env.GUILD_ID || null;
const LOGS_GUILD_ID = process.env.LOGS_GUILD_ID || null;
const MAIN_GUILD_ID = process.env.MAIN_GUILD_ID || process.env.GUILD_ID || null;
const VERIFICATION_CHANNEL_ID = process.env.VERIFICATION_CHANNEL_ID || null;
const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || null;
const VERIFIED_ROLE_NAME = process.env.VERIFIED_ROLE_NAME || 'Vérifié';
const PING_EVERYONE_ON_VERIFY = String(process.env.PING_EVERYONE_ON_VERIFY || 'false').toLowerCase() === 'true';
const REQUIRED_PHONE_DIGITS = Number(process.env.REQUIRED_PHONE_DIGITS || 10);

const pendingVerifications = new Map();

function normalizePhone(rawPhone) {
  const phone = String(rawPhone || '').replace(/\s+/g, '').replace(/-/g, '').replace(/\./g, '');
  return phone;
}

function isValidPhone(rawPhone) {
  const phone = normalizePhone(rawPhone);
  if (!phone) return false;

  if (phone.startsWith('+33')) {
    const digits = phone.replace(/\+/g, '').replace(/^33/, '');
    return digits.length === REQUIRED_PHONE_DIGITS;
  }

  if (phone.startsWith('0')) {
    return phone.length === REQUIRED_PHONE_DIGITS;
  }

  return false;
}

function maskPhone(rawPhone) {
  const phone = normalizePhone(rawPhone);
  const digits = phone.replace(/\D/g, '');
  if (!digits) return 'Inconnu';
  if (digits.length <= 4) return '*'.repeat(digits.length);

  const start = digits.slice(0, 2);
  const end = digits.slice(-2);
  return `${start}******${end}`;
}

function keyForUser(userId) {
  return `${VERIFICATION_GUILD_ID}:${userId}`;
}

function createVerificationPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify_member').setLabel('Verify').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('show_member_number').setLabel('Affiche Num').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('enter_member_code').setLabel('Code').setStyle(ButtonStyle.Success)
  );
}

function createStaffPanelButtons(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`claim_verification_${userId}`).setLabel('Prendre en charge').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`send_code_${userId}`).setLabel('Code').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`approve_verification_${userId}`).setLabel('Validé').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`refuse_verification_${userId}`).setLabel('Refuser').setStyle(ButtonStyle.Danger)
  );
}

async function fetchGuild(guildId) {
  if (!guildId) return null;
  return client.guilds.cache.get(guildId) || await client.guilds.fetch(guildId).catch(() => null);
}

async function sendToLogs(content, embed) {
  if (!LOGS_GUILD_ID || !LOGS_CHANNEL_ID) return;
  const guild = await fetchGuild(LOGS_GUILD_ID);
  if (!guild) return;
  const channel = guild.channels.cache.get(LOGS_CHANNEL_ID) || await guild.channels.fetch(LOGS_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;
  await channel.send({ content, embeds: embed ? [embed] : undefined });
}

async function resolveVerificationChannel() {
  if (!VERIFICATION_GUILD_ID || !VERIFICATION_CHANNEL_ID) return null;
  const guild = await fetchGuild(VERIFICATION_GUILD_ID);
  if (!guild) return null;
  const channel = guild.channels.cache.get(VERIFICATION_CHANNEL_ID) || await guild.channels.fetch(VERIFICATION_CHANNEL_ID).catch(() => null);
  return channel && channel.isTextBased() ? channel : null;
}

function buildVerificationEmbed(member, phone, status = 'En attente') {
  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle('Nouvelle demande de vérification')
    .setDescription('Le membre attend une validation.')
    .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: 'Utilisateur', value: member.user.tag, inline: true },
      { name: 'ID', value: member.id, inline: true },
      { name: 'Téléphone', value: maskPhone(phone), inline: true },
      { name: 'Statut', value: status, inline: true }
    )
    .setTimestamp();
}

async function sendPanelToVerificationChannel() {
  const channel = await resolveVerificationChannel();
  if (!channel) return;

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle('🔐 Vérification requise')
    .setDescription('Clique sur le bouton pour commencer la vérification.')
    .addFields(
      { name: 'Étape 1', value: 'Clique sur Verify', inline: true },
      { name: 'Étape 2', value: 'Entre ton numéro', inline: true },
      { name: 'Étape 3', value: 'Récupère ton code', inline: true }
    )
    .setTimestamp();

  await channel.send({ embeds: [embed], components: [createVerificationPanelButtons()] });
}

async function createVerificationRequest(member, phone) {
  const record = {
    userId: member.id,
    guildId: member.guild.id,
    phone: normalizePhone(phone),
    maskedPhone: maskPhone(phone),
    status: 'pending',
    code: null,
    claimedBy: null,
    staffMessageId: null,
    createdAt: Date.now(),
    verifiedAt: null
  };

  pendingVerifications.set(keyForUser(member.id), record);
  return record;
}

async function sendVerificationToLogs(member, phone) {
  if (!LOGS_GUILD_ID || !LOGS_CHANNEL_ID) return;
  const guild = await fetchGuild(LOGS_GUILD_ID);
  if (!guild) return;
  const channel = guild.channels.cache.get(LOGS_CHANNEL_ID) || await guild.channels.fetch(LOGS_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  const embed = buildVerificationEmbed(member, phone, 'En attente');
  const message = await channel.send({ embeds: [embed], components: [createStaffPanelButtons(member.id)] });

  const verification = pendingVerifications.get(keyForUser(member.id));
  if (verification) {
    verification.staffMessageId = message.id;
    verification.logsChannelId = channel.id;
  }

  return message;
}

async function findRoleInGuild(guildId, roleName) {
  const guild = await fetchGuild(guildId);
  if (!guild) return null;
  return guild.roles.cache.find((role) => role.name === roleName) || guild.roles.cache.find((role) => role.id === roleName) || null;
}

async function banUserFromGuild(guildId, userId, reason = 'Refus de vérification') {
  const guild = await fetchGuild(guildId);
  if (!guild) return;
  const member = await guild.members.fetch(userId).catch(() => null);
  if (!member) return;
  await member.ban({ reason }).catch(() => null);
}

async function approveVerification(memberId) {
  const key = keyForUser(memberId);
  const verification = pendingVerifications.get(key);
  if (!verification) return;

  verification.status = 'verified';
  verification.verifiedAt = Date.now();

  const mainGuild = await fetchGuild(MAIN_GUILD_ID || VERIFICATION_GUILD_ID);
  if (mainGuild) {
    const role = await findRoleInGuild(mainGuild.id, VERIFIED_ROLE_NAME);
    const member = await mainGuild.members.fetch(memberId).catch(() => null);
    if (role && member) {
      await member.roles.add(role).catch(() => null);
    }
  }

  const logsGuild = await fetchGuild(LOGS_GUILD_ID);
  if (logsGuild && LOGS_CHANNEL_ID) {
    const channel = logsGuild.channels.cache.get(LOGS_CHANNEL_ID) || await logsGuild.channels.fetch(LOGS_CHANNEL_ID).catch(() => null);
    if (channel && channel.isTextBased()) {
      const existingMessage = await channel.messages.fetch(verification.staffMessageId).catch(() => null);
      if (existingMessage) {
        const updated = new EmbedBuilder(existingMessage.embeds[0].data)
          .setColor(0x00ff88)
          .setFields(
            ...existingMessage.embeds[0].fields.map((field) => ({ ...field })),
            { name: 'Statut', value: 'Validé', inline: true }
          );
        await existingMessage.edit({ embeds: [updated], components: [] });
      }
    }
  }

  await sendToLogs(PING_EVERYONE_ON_VERIFY ? '@everyone' : '', new EmbedBuilder()
    .setColor(0x00ff88)
    .setTitle('✅ Vérification validée')
    .addFields(
      { name: 'Utilisateur', value: `<@${memberId}>`, inline: true },
      { name: 'Téléphone', value: maskPhone(verification.phone), inline: true },
      { name: 'Statut', value: 'Validé', inline: true }
    )
    .setTimestamp());
}

async function refuseVerification(memberId) {
  const key = keyForUser(memberId);
  const verification = pendingVerifications.get(key);
  if (!verification) return;

  verification.status = 'refused';

  if (MAIN_GUILD_ID) {
    await banUserFromGuild(MAIN_GUILD_ID, memberId, 'Refus de vérification');
  }

  if (VERIFICATION_GUILD_ID) {
    await banUserFromGuild(VERIFICATION_GUILD_ID, memberId, 'Refus de vérification');
  }

  const logsGuild = await fetchGuild(LOGS_GUILD_ID);
  if (logsGuild && LOGS_CHANNEL_ID) {
    const channel = logsGuild.channels.cache.get(LOGS_CHANNEL_ID) || await logsGuild.channels.fetch(LOGS_CHANNEL_ID).catch(() => null);
    if (channel && channel.isTextBased()) {
      const existingMessage = await channel.messages.fetch(verification.staffMessageId).catch(() => null);
      if (existingMessage) {
        const updated = new EmbedBuilder(existingMessage.embeds[0].data)
          .setColor(0xff2e2e)
          .setFields(
            ...existingMessage.embeds[0].fields.map((field) => ({ ...field })),
            { name: 'Statut', value: 'Refusé', inline: true }
          );
        await existingMessage.edit({ embeds: [updated], components: [] });
      }
    }
  }

  pendingVerifications.delete(key);
}

client.once('ready', () => {
  console.log(`✅ Bot prêt : ${client.user.tag}`);
  console.log(`🔐 Verification guild : ${VERIFICATION_GUILD_ID || 'non défini'}`);
  console.log(`📝 Logs guild : ${LOGS_GUILD_ID || 'non défini'}`);
  console.log(`🧩 Main guild : ${MAIN_GUILD_ID || 'non défini'}`);
  console.log(`📣 Verification channel : ${VERIFICATION_CHANNEL_ID || 'non défini'}`);
  console.log(`🗂️ Logs channel : ${LOGS_CHANNEL_ID || 'non défini'}`);
});

client.on('guildMemberAdd', async (member) => {
  if (member.guild.id !== VERIFICATION_GUILD_ID) return;

  const channel = member.guild.channels.cache.get(VERIFICATION_CHANNEL_ID) || member.guild.systemChannel;
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle('🔐 Vérification')
    .setDescription('Clique sur le bouton pour vérifier ton compte.')
    .setTimestamp();

  await channel.send({
    content: `<@${member.id}>`,
    embeds: [embed],
    components: [createVerificationPanelButtons()]
  });
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  if (message.guild.id !== VERIFICATION_GUILD_ID) return;

  if (message.content.startsWith('!panel')) {
    if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return;
    }
    await sendPanelToVerificationChannel();
    await message.reply({ content: 'Le panel a été envoyé dans le salon de vérification.', ephemeral: true }).catch(() => {});
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === 'verify_member') {
      const modal = new ModalBuilder().setCustomId(`phone_modal_${interaction.user.id}`).setTitle('Vérification par téléphone');
      const input = new TextInputBuilder().setCustomId('phone_input').setLabel('Numéro de téléphone').setPlaceholder('06xxxxxxxx ou +336xxxxxxxx').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(10).setMaxLength(15);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId === 'show_member_number') {
      const verification = pendingVerifications.get(keyForUser(interaction.user.id));
      if (!verification) {
        await interaction.reply({ content: 'Aucun numéro enregistré.', ephemeral: true });
        return;
      }
      await interaction.reply({ content: `Votre numéro enregistré : ${maskPhone(verification.phone)}`, ephemeral: true });
      return;
    }

    if (interaction.customId === 'enter_member_code') {
      const modal = new ModalBuilder().setCustomId(`code_modal_${interaction.user.id}`).setTitle('Code de vérification');
      const input = new TextInputBuilder().setCustomId('code_input').setLabel('Code à 4 chiffres').setPlaceholder('1234').setStyle(TextInputStyle.Short).setRequired(true).setMinLength(4).setMaxLength(4);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId.startsWith('claim_verification_')) {
      const targetId = interaction.customId.replace('claim_verification_', '');
      const verification = pendingVerifications.get(`${VERIFICATION_GUILD_ID}:${targetId}`);
      if (!verification) {
        await interaction.reply({ content: 'Cette vérification n’existe plus.', ephemeral: true });
        return;
      }

      verification.claimedBy = interaction.user.id;
      verification.status = 'claimed';

      await interaction.reply({
        content: `Numéro complet : ${verification.phone}`,
        ephemeral: true
      });

      if (interaction.message && interaction.message.edit) {
        const updated = new EmbedBuilder(interaction.message.embeds[0].data)
          .setColor(0xffcc00)
          .setFields(
            ...interaction.message.embeds[0].fields.map((field) => ({ ...field })),
            { name: 'Statut', value: 'Pris en charge', inline: true }
          );
        await interaction.message.edit({ embeds: [updated], components: [createStaffPanelButtons(targetId)] });
      }
      return;
    }

    if (interaction.customId.startsWith('send_code_')) {
      const targetId = interaction.customId.replace('send_code_', '');
      const verification = pendingVerifications.get(`${VERIFICATION_GUILD_ID}:${targetId}`);
      if (!verification) {
        await interaction.reply({ content: 'Cette vérification n’existe plus.', ephemeral: true });
        return;
      }

      const member = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!member) {
        await interaction.reply({ content: 'Membre introuvable.', ephemeral: true });
        return;
      }

      const code = String(Math.floor(1000 + Math.random() * 9000));
      verification.code = code;

      try {
        await member.send(`Votre code de vérification est : **${code}**\nEntrez-le dans le serveur de vérification via le bouton **Code**.`);
      } catch (error) {
        await interaction.reply({ content: 'Le membre a bloqué ses MP, le code n’a pas pu être envoyé.', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `Le code a bien été envoyé au membre <@${targetId}>.`, ephemeral: true });
      return;
    }

    if (interaction.customId.startsWith('approve_verification_')) {
      const targetId = interaction.customId.replace('approve_verification_', '');
      await approveVerification(targetId);
      await interaction.reply({ content: `La vérification de <@${targetId}> a été validée.`, ephemeral: true });
      return;
    }

    if (interaction.customId.startsWith('refuse_verification_')) {
      const targetId = interaction.customId.replace('refuse_verification_', '');
      await refuseVerification(targetId);
      await interaction.reply({ content: `La vérification de <@${targetId}> a été refusée et l'utilisateur a été banni.`, ephemeral: true });
      return;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('phone_modal_')) {
      const phone = interaction.fields.getTextInputValue('phone_input');
      if (!isValidPhone(phone)) {
        await interaction.reply({ content: 'Numéro invalide. Utilisez un format comme `06xxxxxxxx` ou `+336xxxxxxxx`.', ephemeral: true });
        return;
      }

      const verification = await createVerificationRequest(interaction.member, phone);
      await sendVerificationToLogs(interaction.member, verification.phone);
      await interaction.reply({ content: 'Votre demande a été envoyée au staff.', ephemeral: true });
      return;
    }

    if (interaction.customId.startsWith('code_modal_')) {
      const code = interaction.fields.getTextInputValue('code_input');
      const verification = pendingVerifications.get(keyForUser(interaction.user.id));
      if (!verification) {
        await interaction.reply({ content: 'Aucune vérification en cours.', ephemeral: true });
        return;
      }

      if (!/^\d{4}$/.test(code)) {
        await interaction.reply({ content: 'Le code doit contenir exactement 4 chiffres.', ephemeral: true });
        return;
      }

      if (verification.code !== code) {
        await interaction.reply({ content: 'Code invalide.', ephemeral: true });
        return;
      }

      const mainGuild = await fetchGuild(MAIN_GUILD_ID || VERIFICATION_GUILD_ID);
      const role = mainGuild ? await findRoleInGuild(mainGuild.id, VERIFIED_ROLE_NAME) : null;
      if (role) {
        const member = await mainGuild.members.fetch(interaction.user.id).catch(() => null);
        if (member) await member.roles.add(role).catch(() => null);
      }

      verification.status = 'verified';
      verification.verifiedAt = Date.now();
      await interaction.reply({ content: 'Vérification réussie !', ephemeral: true });
      return;
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

app.listen(PORT, () => {
  console.log(`🚀 Service web prêt sur http://localhost:${PORT}`);
});
