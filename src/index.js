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
    GatewayIntentBits.DirectMessages
  ],
  partials: [Partials.Channel, Partials.GuildMember]
});

const PORT = Number(process.env.PORT || 3000);
const VERIFY_TIMEOUT_MINUTES = Number(process.env.VERIFY_TIMEOUT_MINUTES || 10);
const CODE_TIMEOUT_MINUTES = Number(process.env.CODE_TIMEOUT_MINUTES || 10);
const REQUIRED_PHONE_DIGITS = Number(process.env.REQUIRED_PHONE_DIGITS || 10);
const STAFF_CHANNEL_ID = process.env.STAFF_CHANNEL_ID;
const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID;
const VERIFIED_ROLE_NAME = process.env.VERIFIED_ROLE_NAME || 'Membre vérifié';
const PING_EVERYONE_ON_VERIFY = String(process.env.PING_EVERYONE_ON_VERIFY || 'false').toLowerCase() === 'true';

const pendingVerifications = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

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
  if (!phone) return 'Inconnu';

  const digits = phone.replace(/\D/g, '');
  if (digits.length <= 4) return '*'.repeat(digits.length);

  const start = digits.slice(0, 2);
  const end = digits.slice(-2);
  return `${start}******${end}`;
}

function createPanelButtons() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('verify_member')
      .setLabel('Verify')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId('show_member_number')
      .setLabel('Affiche Num')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId('enter_member_code')
      .setLabel('Code')
      .setStyle(ButtonStyle.Success)
  );
}

function createStaffButtons(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId(`claim_verification_${userId}`)
      .setLabel('Claim')
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId(`send_code_${userId}`)
      .setLabel('Envoyer le code')
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId(`refuse_verification_${userId}`)
      .setLabel('Refuser')
      .setStyle(ButtonStyle.Danger)
  );
}

async function getGuild() {
  return client.guilds.cache.get(process.env.GUILD_ID) || await client.guilds.fetch(process.env.GUILD_ID).catch(() => null);
}

function buildVerificationEmbed(member, phone, status = 'En attente') {
  return new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle('Nouvelle vérification')
    .setDescription('Une demande de vérification a été soumise.')
    .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: 'Utilisateur', value: `${member.user.tag}`, inline: true },
      { name: 'ID', value: `${member.id}`, inline: true },
      { name: 'Téléphone', value: `${maskPhone(phone)}`, inline: true },
      { name: 'Statut', value: status, inline: true }
    )
    .setTimestamp();
}

async function sendToLogs(content, embed) {
  if (!LOGS_CHANNEL_ID) return;

  const channel = await client.channels.fetch(LOGS_CHANNEL_ID).catch(() => null);
  if (!channel || !channel.isTextBased()) return;

  await channel.send({ content, embeds: embed ? [embed] : undefined });
}

async function createVerificationRequest(member, phone) {
  const normalized = normalizePhone(phone);
  const record = {
    userId: member.id,
    guildId: member.guild.id,
    phone: normalized,
    maskedPhone: maskPhone(normalized),
    code: null,
    claimedBy: null,
    status: 'pending',
    createdAt: Date.now(),
    expiresAt: Date.now() + VERIFY_TIMEOUT_MINUTES * 60 * 1000,
    codeExpiresAt: Date.now() + CODE_TIMEOUT_MINUTES * 60 * 1000
  };

  pendingVerifications.set(member.id, record);
  return record;
}

async function updatePendingStatus(memberId, status) {
  const verification = pendingVerifications.get(memberId);
  if (verification) {
    verification.status = status;
    if (status === 'verified') verification.verifiedAt = Date.now();
  }
}

async function handleVerifyButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(`phone_modal_${interaction.user.id}`)
    .setTitle('Vérification par téléphone');

  const phoneInput = new TextInputBuilder()
    .setCustomId('phone_input')
    .setLabel('Numéro de téléphone')
    .setPlaceholder('06xxxxxxxx ou +336xxxxxxxx')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(10)
    .setMaxLength(15);

  const row = new ActionRowBuilder().addComponents(phoneInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

async function handleMemberNumberButton(interaction) {
  const verification = pendingVerifications.get(interaction.user.id);
  const phone = verification?.phone || null;

  if (!phone) {
    await interaction.reply({
      content: 'Aucun numéro enregistré. Clique sur **Verify** pour commencer la vérification.',
      ephemeral: true
    });
    return;
  }

  await interaction.reply({
    content: `Votre numéro enregistré : ${maskPhone(phone)}`,
    ephemeral: true
  });
}

async function handleCodeButton(interaction) {
  const modal = new ModalBuilder()
    .setCustomId(`code_modal_${interaction.user.id}`)
    .setTitle('Code de vérification');

  const codeInput = new TextInputBuilder()
    .setCustomId('code_input')
    .setLabel('Code à 4 chiffres')
    .setPlaceholder('1234')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMinLength(4)
    .setMaxLength(4);

  const row = new ActionRowBuilder().addComponents(codeInput);
  modal.addComponents(row);

  await interaction.showModal(modal);
}

async function onPhoneSubmitted(interaction) {
  const phone = interaction.fields.getTextInputValue('phone_input');

  if (!isValidPhone(phone)) {
    await interaction.reply({
      content: 'Numéro invalide. Utilise un format comme `06xxxxxxxx` ou `+336xxxxxxxx`.',
      ephemeral: true
    });
    return;
  }

  const member = interaction.member;
  const existing = pendingVerifications.get(member.id);

  if (existing && existing.status !== 'refused' && existing.status !== 'verified') {
    await interaction.reply({
      content: 'Une vérification est déjà en cours pour ton compte.',
      ephemeral: true
    });
    return;
  }

  await createVerificationRequest(member, phone);

  const record = pendingVerifications.get(member.id);
  const guild = await getGuild();
  const staffChannel = guild ? guild.channels.cache.get(STAFF_CHANNEL_ID) || await guild.channels.fetch(STAFF_CHANNEL_ID).catch(() => null) : null;

  if (!staffChannel || staffChannel.type !== ChannelType.GuildText) {
    await interaction.reply({
      content: 'Le salon staff n’est pas configuré. Contacte un administrateur.',
      ephemeral: true
    });
    return;
  }

  const embed = buildVerificationEmbed(member, record.phone, 'En attente');
  const row = createStaffButtons(member.id);

  const sentMessage = await staffChannel.send({
    embeds: [embed],
    components: [row]
  });

  record.staffMessageId = sentMessage.id;
  record.staffChannelId = staffChannel.id;

  await interaction.reply({
    content: 'Votre demande de vérification a bien été envoyée au staff.',
    ephemeral: true
  });

  await sendToLogs('Nouvelle demande de vérification', embed);
}

async function onCodeSubmitted(interaction) {
  const code = interaction.fields.getTextInputValue('code_input');
  const verification = pendingVerifications.get(interaction.user.id);

  if (!verification) {
    await interaction.reply({
      content: 'Aucune vérification en cours.',
      ephemeral: true
    });
    return;
  }

  if (!/^\d{4}$/.test(code)) {
    await interaction.reply({
      content: 'Le code doit contenir exactement 4 chiffres.',
      ephemeral: true
    });
    return;
  }

  if (verification.code !== code) {
    await interaction.reply({
      content: 'Code invalide. Vérifie le code reçu dans le DM.',
      ephemeral: true
    });
    return;
  }

  const guild = await getGuild();
  const role = guild?.roles.cache.find((r) => r.name === VERIFIED_ROLE_NAME) || guild?.roles.cache.find((r) => r.id === VERIFIED_ROLE_NAME);

  if (role) {
    const member = await guild.members.fetch(interaction.user.id).catch(() => null);
    if (member) await member.roles.add(role).catch(() => null);
  }

  verification.status = 'verified';
  verification.verifiedAt = Date.now();

  try {
    await interaction.reply({
      content: 'Vérification réussie ! Vous avez le rôle attribué.',
      ephemeral: true
    });
  } catch (error) {
    // no-op
  }

  const logEmbed = new EmbedBuilder()
    .setColor(0x00ff88)
    .setTitle('Vérification validée')
    .addFields(
      { name: 'Utilisateur', value: `${interaction.user.tag}`, inline: true },
      { name: 'Téléphone', value: `${verification.maskedPhone}`, inline: true },
      { name: 'Code', value: `${verification.code}`, inline: true }
    )
    .setTimestamp();

  await sendToLogs(PING_EVERYONE_ON_VERIFY ? '@everyone' : '', logEmbed);

  if (STAFF_CHANNEL_ID) {
    const staffChannel = guild?.channels.cache.get(STAFF_CHANNEL_ID) || await guild?.channels.fetch(STAFF_CHANNEL_ID).catch(() => null);
    if (staffChannel && staffChannel.isTextBased()) {
      const existing = await staffChannel.messages.fetch(verification.staffMessageId).catch(() => null);
      if (existing) {
        const updatedEmbed = new EmbedBuilder(existing.embeds[0].data)
          .setColor(0x00ff88)
          .setFields(
            ...existing.embeds[0].fields.map((field) => ({ ...field })),
            { name: 'Statut', value: 'Validée', inline: true }
          );

        await existing.edit({ embeds: [updatedEmbed], components: [] });
      }
    }
  }
}

client.on('ready', () => {
  console.log(`Bot prêt : ${client.user.tag}`);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild) return;

  if (!message.content.startsWith('!')) return;

  const args = message.content.slice(1).trim().split(/\s+/);
  const command = args[0]?.toLowerCase();

  if (command === 'panel') {
    if (!message.member.permissions.has(PermissionFlagsBits.Administrator)) {
      return;
    }

    const panelEmbed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('🔐 Vérification requise')
      .setDescription('Clique sur le bouton pour commencer la vérification.\nLe numéro sera visible uniquement pour toi, puis le staff recevra le ticket.')
      .addFields(
        { name: 'Étape 1', value: 'Clique sur Verify', inline: true },
        { name: 'Étape 2', value: 'Envoie ton numéro', inline: true },
        { name: 'Étape 3', value: 'Récupère le code', inline: true }
      )
      .setTimestamp();

    await message.channel.send({
      embeds: [panelEmbed],
      components: [createPanelButtons()]
    });
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    const userId = interaction.user.id;

    if (interaction.customId === 'verify_member') {
      await handleVerifyButton(interaction);
      return;
    }

    if (interaction.customId === 'show_member_number') {
      await handleMemberNumberButton(interaction);
      return;
    }

    if (interaction.customId === 'enter_member_code') {
      await handleCodeButton(interaction);
      return;
    }

    if (interaction.customId.startsWith('claim_verification_')) {
      const targetId = interaction.customId.replace('claim_verification_', '');
      const verification = pendingVerifications.get(targetId);

      if (!verification) {
        await interaction.reply({ content: 'Cette demande n’existe plus.', ephemeral: true });
        return;
      }

      verification.claimedBy = interaction.user.id;
      verification.status = 'claimed';

      const staffChannel = interaction.channel;
      const buttons = new ActionRowBuilder().addComponents(
        new ButtonBuilder()
          .setCustomId(`claim_verification_${targetId}`)
          .setLabel('Claimé')
          .setStyle(ButtonStyle.Secondary)
          .setDisabled(true),
        new ButtonBuilder()
          .setCustomId(`send_code_${targetId}`)
          .setLabel('Envoyer le code')
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(`refuse_verification_${targetId}`)
          .setLabel('Refuser')
          .setStyle(ButtonStyle.Danger)
      );

      await interaction.message.edit({ components: [buttons] });
      await interaction.reply({ content: `Tu as claimé la vérification de <@${targetId}>.`, ephemeral: true });
      return;
    }

    if (interaction.customId.startsWith('send_code_')) {
      const targetId = interaction.customId.replace('send_code_', '');
      const verification = pendingVerifications.get(targetId);

      if (!verification) {
        await interaction.reply({ content: 'Cette demande n’existe plus.', ephemeral: true });
        return;
      }

      const member = await interaction.guild.members.fetch(targetId).catch(() => null);
      if (!member) {
        await interaction.reply({ content: 'Membre introuvable.', ephemeral: true });
        return;
      }

      const code = String(Math.floor(1000 + Math.random() * 9000));
      verification.code = code;
      verification.codeExpiresAt = Date.now() + CODE_TIMEOUT_MINUTES * 60 * 1000;

      try {
        await member.send(`Votre code de vérification est : **${code}**\nEntrez-le dans le panel par le bouton **Code**.`);
      } catch (error) {
        await interaction.reply({ content: 'Le membre a bloqué ses MP. Le code n’a pas pu être envoyé.', ephemeral: true });
        return;
      }

      const logEmbed = new EmbedBuilder()
        .setColor(0xffcc00)
        .setTitle('Code envoyé')
        .addFields(
          { name: 'Utilisateur', value: `${member.user.tag}`, inline: true },
          { name: 'Téléphone', value: `${verification.maskedPhone}`, inline: true },
          { name: 'Code', value: `${code}`, inline: true }
        )
        .setTimestamp();

      await sendToLogs('Code envoyé au membre', logEmbed);
      await interaction.reply({ content: `Le code a bien été envoyé à <@${targetId}>.`, ephemeral: true });
      return;
    }

    if (interaction.customId.startsWith('refuse_verification_')) {
      const targetId = interaction.customId.replace('refuse_verification_', '');
      const verification = pendingVerifications.get(targetId);

      if (!verification) {
        await interaction.reply({ content: 'Cette demande n’existe plus.', ephemeral: true });
        return;
      }

      verification.status = 'refused';
      await interaction.reply({ content: `La demande de <@${targetId}> a été refusée.`, ephemeral: true });
      return;
    }
  }

  if (interaction.isModalSubmit()) {
    if (interaction.customId.startsWith('phone_modal_')) {
      await onPhoneSubmitted(interaction);
      return;
    }

    if (interaction.customId.startsWith('code_modal_')) {
      await onCodeSubmitted(interaction);
      return;
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

app.listen(PORT, () => {
  console.log(`Service web prêt sur http://localhost:${PORT}`);
});
