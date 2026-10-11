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
const GUILD_ID = process.env.GUILD_ID || null;
const VERIFICATION_CHANNEL_ID = process.env.VERIFICATION_CHANNEL_ID || null;
const LOGS_CHANNEL_ID = process.env.LOGS_CHANNEL_ID || null;
const VERIFIED_ROLE_NAME = process.env.VERIFIED_ROLE_NAME || 'Vérifié';
const REQUIRED_PHONE_DIGITS = Number(process.env.REQUIRED_PHONE_DIGITS || 10);

const pendingVerifications = new Map();

function normalizePhone(rawPhone) {
  return String(rawPhone || '').replace(/\s+/g, '').replace(/-/g, '').replace(/\./g, '');
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

  const first = digits.slice(0, 2);
  const last = digits.slice(-2);
  return `${first}******${last}`;
}

function getKey(userId) {
  return `${GUILD_ID}:${userId}`;
}

async function fetchGuild() {
  if (!GUILD_ID) return null;
  return client.guilds.cache.get(GUILD_ID) || (await client.guilds.fetch(GUILD_ID).catch(() => null));
}

function createVerifyButton() {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('verify_member').setLabel('Verify').setStyle(ButtonStyle.Primary)
  );
}

function createStaffButtons(userId) {
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`claim_verification_${userId}`).setLabel('Prendre en charge').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId(`request_code_${userId}`).setLabel('Code').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`approve_verification_${userId}`).setLabel('Valider').setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`refuse_verification_${userId}`).setLabel('Refuser').setStyle(ButtonStyle.Danger)
  );
}

async function findRole(guild, roleName) {
  if (!guild) return null;
  return guild.roles.cache.find((role) => role.name === roleName) || null;
}

async function getVerificationChannel() {
  if (!GUILD_ID || !VERIFICATION_CHANNEL_ID) return null;
  const guild = await fetchGuild();
  if (!guild) return null;
  return guild.channels.cache.get(VERIFICATION_CHANNEL_ID) || (await guild.channels.fetch(VERIFICATION_CHANNEL_ID).catch(() => null));
}

async function getLogsChannel() {
  if (!GUILD_ID || !LOGS_CHANNEL_ID) return null;
  const guild = await fetchGuild();
  if (!guild) return null;
  return guild.channels.cache.get(LOGS_CHANNEL_ID) || (await guild.channels.fetch(LOGS_CHANNEL_ID).catch(() => null));
}

async function createMemberThread(member) {
  const verificationChannel = await getVerificationChannel();
  if (!verificationChannel || !verificationChannel.isTextBased()) return null;

  const threadName = `Vérif - ${member.user.username}`;

  let thread = verificationChannel.threads.cache.find((t) => t.name === threadName);
  if (!thread) {
    thread = await verificationChannel.threads.create({
      name: threadName,
      autoArchiveDuration: 60,
      type: ChannelType.PrivateThread,
      invitable: false
    }).catch(() => null);
  }

  if (!thread) return null;

  try {
    await thread.members.add(member.id).catch(() => {});
  } catch (err) {}

  return thread;
}

async function ensureThreadForMember(member) {
  const thread = await createMemberThread(member);
  if (!thread) return null;

  const existing = await thread.messages.fetch({ limit: 20 }).catch(() => null);
  if (!existing || existing.size === 0) {
    const embed = new EmbedBuilder()
      .setColor(0x0099ff)
      .setTitle('🔐 Vérification')
      .setDescription('Clique sur le bouton pour commencer la vérification.')
      .setTimestamp();

    await thread.send({ embeds: [embed], components: [createVerifyButton()] });
  }

  return thread;
}

async function createVerificationRequest(member, phone) {
  const record = {
    userId: member.id,
    guildId: member.guild.id,
    phone: normalizePhone(phone),
    maskedPhone: maskPhone(phone),
    code: null,
    enteredCode: null,
    status: 'pending',
    claimedBy: null,
    staffMessageId: null,
    codeRequested: false,
    threadId: null,
    createdAt: Date.now(),
    verifiedAt: null
  };

  pendingVerifications.set(getKey(member.id), record);
  return record;
}

async function sendToStaffPanel(member, phone) {
  const channel = await getLogsChannel();
  if (!channel || !channel.isTextBased()) return;

  const embed = new EmbedBuilder()
    .setColor(0x0099ff)
    .setTitle('Nouvelle demande de vérification')
    .setDescription('Le membre attend une validation.')
    .setThumbnail(member.displayAvatarURL({ dynamic: true, size: 256 }))
    .addFields(
      { name: 'Utilisateur', value: member.user.tag, inline: true },
      { name: 'ID', value: member.id, inline: true },
      { name: 'Téléphone', value: maskPhone(phone), inline: true },
      { name: 'Statut', value: 'En attente', inline: true }
    )
    .setTimestamp();

  const message = await channel.send({ embeds: [embed], components: [createStaffButtons(member.id)] });

  const verification = pendingVerifications.get(getKey(member.id));
  if (verification) verification.staffMessageId = message.id;
}

async function updateStaffPanelStatus(memberId, status, color) {
  const verification = pendingVerifications.get(getKey(memberId));
  if (!verification || !verification.staffMessageId) return;

  const channel = await getLogsChannel();
  if (!channel || !channel.isTextBased()) return;

  const existingMessage = await channel.messages.fetch(verification.staffMessageId).catch(() => null);
  if (!existingMessage || !existingMessage.embeds[0]) return;

  const oldFields = existingMessage.embeds[0].fields || [];
  const cleanFields = oldFields.filter((field) => field.name !== 'Statut');
  cleanFields.push({ name: 'Statut', value: status, inline: true });

  const updated = new EmbedBuilder(existingMessage.embeds[0].data)
    .setColor(color)
    .setFields(cleanFields);

  await existingMessage.edit({ embeds: [updated] });
}

async function sendCodeRequestToMember(memberId) {
  const verification = pendingVerifications.get(getKey(memberId));
  if (!verification) return false;

  const guild = await fetchGuild();
  if (!guild) return false;

  const member = await guild.members.fetch(memberId).catch(() => null);
  if (!member) return false;

  const thread = await createMemberThread(member);
  if (!thread) return false;

  verification.codeRequested = true;

  await thread.send({
    content: 'Le staff a demandé un code à 4 chiffres. Écris-le dans ce thread.'
  });

  return true;
}

async function approveVerification(memberId) {
  const verification = pendingVerifications.get(getKey(memberId));
  if (!verification) return false;

  if (!verification.enteredCode || !verification.code) return false;

  if (verification.enteredCode !== verification.code) return false;

  verification.status = 'verified';
  verification.verifiedAt = Date.now();

  const guild = await fetchGuild();
  if (guild) {
    const member = await guild.members.fetch(memberId).catch(() => null);
    const role = await findRole(guild, VERIFIED_ROLE_NAME);
    if (member && role) {
      await member.roles.add(role).catch(() => null);
    }
  }

  await updateStaffPanelStatus(memberId, 'Validé', 0x00ff88);

  return true;
}

async function refuseVerification(memberId) {
  const verification = pendingVerifications.get(getKey(memberId));
  if (!verification) return;

  verification.status = 'refused';

  const guild = await fetchGuild();
  if (guild) {
    const member = await guild.members.fetch(memberId).catch(() => null);
    if (member) {
      await member.ban({ reason: 'Refus de vérification' }).catch(() => null);
    }
  }

  await updateStaffPanelStatus(memberId, 'Refusé', 0xff2e2e);
  pendingVerifications.delete(getKey(memberId));
}

client.once('ready', () => {
  console.log(`✅ Bot prêt : ${client.user.tag}`);
  console.log(`🧩 Serveur : ${GUILD_ID || 'non défini'}`);
  console.log(`📣 Verification : ${VERIFICATION_CHANNEL_ID || 'non défini'}`);
  console.log(`🗂️ Logs staff : ${LOGS_CHANNEL_ID || 'non défini'}`);
  console.log(`✅ Rôle vérifié : ${VERIFIED_ROLE_NAME}`);
});

client.on('guildMemberAdd', async (member) => {
  if (!GUILD_ID || member.guild.id !== GUILD_ID) return;
  await ensureThreadForMember(member);
});

client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (!message.guild || message.guild.id !== GUILD_ID) return;

  if (message.content.startsWith('!panel')) {
    if (!message.member || !message.member.permissions.has(PermissionFlagsBits.Administrator)) return;
    await ensureThreadForMember(message.member);
    await message.reply({ content: 'Le thread de vérification a été préparé.' }).catch(() => {});
  }

  if (!message.channel.isThread()) return;

  const verification = pendingVerifications.get(getKey(message.author.id));
  if (!verification) return;

  if (verification.codeRequested && /^\d{4}$/.test(message.content.trim())) {
    verification.code = message.content.trim();
    verification.enteredCode = message.content.trim();

    await message.reply({ content: 'Votre code a bien été enregistré. Un staff va maintenant le valider.' });
    return;
  }
});

client.on('interactionCreate', async (interaction) => {
  if (interaction.isButton()) {
    if (interaction.customId === 'verify_member') {
      const modal = new ModalBuilder().setCustomId(`phone_modal_${interaction.user.id}`).setTitle('Vérification par téléphone');
      const input = new TextInputBuilder()
        .setCustomId('phone_input')
        .setLabel('Numéro de téléphone')
        .setPlaceholder('06xxxxxxxx ou +336xxxxxxxx')
        .setStyle(TextInputStyle.Short)
        .setRequired(true)
        .setMinLength(10)
        .setMaxLength(15);

      modal.addComponents(new ActionRowBuilder().addComponents(input));
      await interaction.showModal(modal);
      return;
    }

    if (interaction.customId.startsWith('claim_verification_')) {
      const targetId = interaction.customId.replace('claim_verification_', '');
      const verification = pendingVerifications.get(getKey(targetId));
      if (!verification) {
        await interaction.reply({ content: 'Cette demande n’existe plus.', ephemeral: true });
        return;
      }

      verification.claimedBy = interaction.user.id;
      verification.status = 'claimed';

      await interaction.reply({
        content: `Tu as pris en charge cette demande. Numéro complet : ${verification.phone}`,
        ephemeral: true
      });

      await updateStaffPanelStatus(targetId, 'Pris en charge', 0xffcc00);
      return;
    }

    if (interaction.customId.startsWith('request_code_')) {
      const targetId = interaction.customId.replace('request_code_', '');
      const verification = pendingVerifications.get(getKey(targetId));
      if (!verification) {
        await interaction.reply({ content: 'Cette demande n’existe plus.', ephemeral: true });
        return;
      }

      const ok = await sendCodeRequestToMember(targetId);
      if (!ok) {
        await interaction.reply({ content: 'Impossible d’envoyer la demande de code au membre.', ephemeral: true });
        return;
      }

      await interaction.reply({ content: `La demande de code a été envoyée à <@${targetId}>.`, ephemeral: true });
      return;
    }

    if (interaction.customId.startsWith('approve_verification_')) {
      const targetId = interaction.customId.replace('approve_verification_', '');
      const isValid = await approveVerification(targetId);

      if (!isValid) {
        await interaction.reply({ content: 'Le code est incorrect ou pas encore saisi.', ephemeral: true });
        return;
      }

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

      const member = interaction.member;
      if (!member) {
        await interaction.reply({ content: 'Impossible de récupérer ton profil.', ephemeral: true });
        return;
      }

      const record = await createVerificationRequest(member, phone);
      await sendToStaffPanel(member, record.phone);

      await interaction.reply({
        content: `Votre numéro a bien été enregistré. Un staff va le vérifier.\nNuméro : ${maskPhone(phone)}`,
        ephemeral: true
      });
      return;
    }
  }
});

client.login(process.env.DISCORD_TOKEN);

app.listen(PORT, () => {
  console.log(`🚀 Service web prêt sur http://localhost:${PORT}`);
});
