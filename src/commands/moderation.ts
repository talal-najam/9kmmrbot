import { ChatUserstate } from 'tmi.js';
import { ID } from '@node-steam/id';
import Mongo from '../mongo';
import CustomError from '../customError';
import Twitch from '../twitch';
import Command from './index';
import Dota from '../dota';

const mongo = Mongo.getInstance();
const twitch = Twitch.getInstance();
const command = Command.getInstance();

const getTime = (date: Date) => `${date.getUTCFullYear()}/${date.getUTCMonth() + 1}/${date.getUTCDate()} ${date.getUTCHours()}:${date.getUTCMinutes() < 10 ? '0' : ''}${date.getUTCMinutes()}:${date.getUTCSeconds() < 10 ? '0' : ''}${date.getUTCSeconds()}`;

const returnAccountId = (str: string) => {
  try {
    return new ID(str).getAccountID();
  } catch (e) {
    return Number(str);
  }
};
export default async function moderation(channel: string, tags: ChatUserstate, commandName: string, ...args: string[]): Promise<string> {
  const db = await mongo.db;
  const userId = Number(tags['user-id']);
  const roomId = Number(tags['room-id']);
  const channels = await db.collection('channels').find({ id: { $in: [userId, roomId] } }).toArray();
  const channelDocument = channels.find((document) => document.id === roomId);
  const userDocument = channels.find((document) => document.id === userId);
  if (roomId !== userId && !userDocument?.globalMod && (!(channelDocument?.mods?.some((mod: Number) => mod === userId)))) return '';
  if (args?.length === 0) return '';
  switch (args[0].toLowerCase()) {
    case 'id':
      if (args.length > 1) {
        const heroName = args.slice(1).join(' ');
        const heroQuery = await db.collection('heroes').findOne({ $or: [{ custom: false }, { custom: { $exists: false } }], localized_name: { $regex: heroName, $options: 'i' } });
        if (!heroQuery) throw new CustomError(`Hero ${heroName} doesn't exist`);
        const game = await Dota.findGame(channelDocument, true);
        const player = game.players.find((tempPlayer: { hero_id: any; }) => tempPlayer.hero_id === heroQuery.id);
        if (!player) {
          throw new CustomError(`Hero ${heroQuery.localized_name} isn't in the current game`);
        }
        return `${heroQuery.localized_name}: ${player.account_id}`;
      }
      break;
    case 'listacc':
      if (channelDocument?.accounts?.length) {
        return `Accounts linked to ${channel.substring(1)}: ${channelDocument?.accounts.join(', ')}`;
      }
      throw new CustomError('No accounts connected');
    case 'addacc':
      if (args.length === 2) {
        const id = returnAccountId(args[1]);
        if (Number.isNaN(id)) {
          throw new CustomError('Wrong syntax: !9kmmrbot addacc id');
        } else {
          try {
            await db.collection('channels').updateOne({ id: roomId }, { $addToSet: { accounts: id } });
            return `${tags.username} succesfully added ${id} to ${channel.substring(1)} accounts`;
          } catch (err) {
            throw new CustomError(`Error adding ${id} to ${channel.substring(1)} accounts`);
          }
        }
      } else {
        throw new CustomError('Wrong syntax: !9kmmrbot addacc id');
      }
    case 'delacc':
      if (args.length === 2) {
        const id = returnAccountId(args[1]);
        if (Number.isNaN(id)) {
          throw new CustomError('Wrong syntax: !9kmmrbot delacc id');
        }
        try {
          await db.collection('channels').updateOne({ id: roomId }, { $pull: { accounts: id } });
          return `${tags.username} succesfully removed ${id} from ${channel.substring(1)} accounts`;
        } catch (err) {
          throw new CustomError(`Error removing ${id} from ${channel.substring(1)} accounts`);
        }
      } else {
        throw new CustomError('Wrong syntax: !9kmmrbot delacc id');
      }
    case 'addnp':
      if (args.length > 2) {
        const id = returnAccountId(args[1]);
        if (Number.isNaN(id)) {
          throw new CustomError('Wrong syntax: !9kmmrbot addnp id nickname');
        } else {
          try {
            await db.collection('notablePlayers').updateOne({ id, channel: roomId }, {
              $set: {
                id, channel: roomId, name: args.slice(2).join(' '), enabled: true, lastChanged: new Date(), lastChangedBy: userId,
              },
            }, { upsert: true });
            return `${tags.username} successfully added ${id} to ${channel.substring(1)} local notable players`;
          } catch (err) {
            throw new CustomError(`Error adding ${id} to ${channel.substring(1)} local notable players`);
          }
        }
      } else {
        throw new CustomError('Wrong syntax: !9kmmrbot addnp id nickname');
      }
    case 'delnp':
      if (args.length === 2) {
        const id = returnAccountId(args[1]);
        if (Number.isNaN(id)) {
          throw new CustomError('Wrong syntax: !9kmmrbot delnp id');
        } else {
          try {
            await db.collection('notablePlayers').updateOne({ id, channel: roomId }, {
              $set: {
                id, enabled: false, lastChanged: new Date(), lastChangedBy: userId,
              },
            });
            return `${tags.username} successfully removed ${id} from ${channel.substring(1)} local notable players`;
          } catch (err) {
            throw new CustomError(`Error removing ${id} from ${channel.substring(1)} local notable players`);
          }
        }
      } else {
        throw new CustomError('Wrong syntax: !9kmmrbot delnp id');
      }
    case 'addmod':
      if (args.length > 1 && (roomId === userId || userDocument?.globalMod)) {
        let username = args[1];
        if (username.startsWith('@')) username = username.substring(1);
        try {
          if ((/^[a-zA-Z0-9][\w]{0,24}$/).test(username)) {
            const { data: [user] } = await Twitch.api('users', { login: username });
            await db.collection('channels').updateOne({ id: roomId }, { $addToSet: { mods: Number(user.id) } });
            return `Successfully added ${username} to ${channel.substring(1)} 9kmmrbot mods`;
          }
          throw new Error('Not a valid twitch username');
        } catch (err) {
          throw new Error(`Error adding ${username} to ${channel.substring(1)} 9kmmrbot mods`);
        }
      }
      break;
    case 'delmod':
      if (args.length > 1 && (roomId === userId || userDocument?.globalMod)) {
        let username = args[1];
        if (username.startsWith('@')) username = username.substring(1);
        try {
          if ((/^[a-zA-Z0-9][\w]{0,24}$/).test(username)) {
            const { data: [user] } = await Twitch.api('users', { login: username });
            await db.collection('channels').updateOne({ id: roomId }, { $pull: { mods: Number(user.id) } });
            return `Successfully removed ${username} from ${channel.substring(1)} 9kmmrbot mods`;
          }
          throw new Error('Not a valid twitch username');
        } catch (err) {
          throw new Error(`Error removing ${username} from ${channel.substring(1)} 9kmmrbot mods`);
        }
      }
      break;
    case 'hc':
      if (args[1] === 'addhero') {
        const heroName = args.slice(2).join(' ');
        const heroQuery = await db.collection('heroes').findOne({ $or: [{ custom: false }, { custom: { $exists: false } }], localized_name: { $regex: heroName, $options: 'i' } });
        if (!heroQuery) throw new CustomError(`Hero ${heroName} doesn't exist`);
        const channelQuery = await db.collection('channels').findOne({ id: Number(tags['room-id']) });
        if (channelQuery.hc.find((hc: { hero_id: number; }) => hc.hero_id === heroQuery.id)) return `Hero ${heroQuery.localized_name} already exists. In order to change starting time, use !9kmmrbot hc settime `;
        const start = new Date();
        await db.collection('channels').updateOne({ id: roomId }, { $push: { hc: { hero_id: heroQuery.id, date: start } } });
        return `Added ${heroQuery.localized_name} to hero challenge list and start time to ${getTime(start)}`;
      }
      if (args[1] === 'delhero') {
        const heroName = args.slice(2).join(' ');
        const heroQuery = await db.collection('heroes').findOne({ $or: [{ custom: false }, { custom: { $exists: false } }], localized_name: { $regex: heroName, $options: 'i' } });
        if (!heroQuery) throw new CustomError(`Hero ${heroName} doesn't exist`);
        await db.collection('channels').updateOne({ id: roomId }, { $pull: { hc: { hero_id: heroQuery.id } } });
        return `Removed ${heroQuery.localized_name} from hero challenge list`;
      } if (args[1] === 'settime') {
        if (!args[2]) return 'Wrong syntax: !9kmmrbot hc settime hero name | time';
        const split = args.slice(2).join(' ').split('|');
        const heroName = split[0].trim();
        const heroQuery = await db.collection('heroes').findOne({ $or: [{ custom: false }, { custom: { $exists: false } }], localized_name: { $regex: heroName, $options: 'i' } });
        if (!heroQuery) throw new CustomError(`Hero ${heroName} doesn't exist`);
        let start = new Date();
        if (split.length > 1) {
          start = new Date(split[1].trim());
          if (start.toString() === 'Invalid Date') start = new Date();
        }
        await db.collection('channels').updateOne({ id: roomId, 'hc.hero_id': heroQuery.id }, { $set: { 'hc.$.date': start } });
        return `Updated ${heroQuery.localized_name} start time to ${getTime(start)}`;
      }
      if (args[1] === 'list') {
        const channelQuery = await db.collection('channels').findOne({ id: Number(tags['room-id']) });
        if (!channelQuery?.hc?.length) throw new CustomError('Hero challenge empty');
        const heroesQuery = await db.collection('heroes').find({ id: { $in: channelQuery.hc.map((tempHero: { hero_id: number; }) => tempHero.hero_id) } }).toArray();
        return channelQuery.hc.map((hc: { hero_id: number; date: Date; }) => `${Dota.getHeroName(channelQuery, heroesQuery.filter((hero) => hero.id === hc.hero_id), 0, 0)} since ${getTime(hc.date)}`).join(', ');
      }
      return '';
    case 'toggleself':
      await db.collection('channels').updateOne({ id: roomId }, { $set: { self: !channelDocument.self } });
      return `Toggled showing streamer as a notable player ${!channelDocument.self ? 'on' : 'off'}`;
    case 'toggleemotes':
      await db.collection('channels').updateOne({ id: roomId }, { $set: { emotes: !channelDocument.emotes } });
      return `Toggled showing emotes instead of hero names ${!channelDocument.emotes ? 'on' : 'off'}`;
    case 'delay':
      if (args.length === 1) return `Showing games ${channelDocument.delay?.enabled ? `in ${channelDocument.delay.seconds} seconds delay` || 30 : 'live'}`;
      if (args[1] === 'on') {
        await db.collection('channels').updateOne({ id: roomId }, { $set: { 'delay.enabled': true } });
        return 'Turned delay on';
      }
      if (args[1] === 'off') {
        await db.collection('channels').updateOne({ id: roomId }, { $set: { 'delay.enabled': false } });
        return 'Turned delay off';
      }
      if (args[1] === 'set' && args.length === 3) {
        const index = Number(args[2]);
        if (!Number.isNaN(index) && index > 0 && index < 601 && index % 30 === 0) {
          await db.collection('channels').updateOne({ id: roomId }, { $set: { 'delay.seconds': index } });
          return `Set delay to ${index}`;
        }
      }
      break;
    case 'addemotes':
      if (!userDocument?.globalMod) return '';
      if (args.length > 1) {
        const split = args.slice(1).join(' ').split(',').map((arg) => arg.trim());
        if (split.length !== 2) throw new CustomError('Wrong syntax: !9kmmrbot emotes add emotes, hero');
        const emotesList = split[0].split(' ');
        const { emotesets } = twitch;
        const emotesetsKeys = Object.keys(emotesets);
        const resultEmotes = [];
        const resultEmoteSets = [];
        for (let i = 0; i < emotesList.length; i += 1) {
          let found = false;
          for (let j = 0; j < emotesetsKeys.length && !found; j += 1) {
            const foundemote = emotesets[emotesetsKeys[j]].find((emote: {
              code: string;
            }) => emote.code === emotesList[i]);
            if (foundemote) {
              resultEmotes.push(foundemote.id);
              resultEmoteSets.push(emotesetsKeys[j]);
              found = true;
            }
          }
          if (!found) throw new CustomError(`Emote ${emotesList[i]} wasn't found on the bot`);
        }
        const heroQuery = await db.collection('heroes').findOne({ $or: [{ custom: false }, { custom: { $exists: false } }], localized_name: { $regex: split[1], $options: 'i' } });
        if (!heroQuery) throw new CustomError(`Hero ${split[1]} doesn't exist`);
        db.collection('heroes').insertOne({
          id: heroQuery.id,
          custom: true,
          emotes: resultEmotes,
          emotesets: resultEmoteSets,
          localized_name: ` ${split[0]} `,
        });
        return `Emotes ${emotesList.join(' ')} added as custom emote for hero ${heroQuery.localized_name}`;
      }
      return '';
    case 'delemotes':
      if (!userDocument?.globalMod) return '';
      if (args.length > 1) {
        const split = args.slice(1).join(' ').split(',').map((arg) => arg.trim());
        if (split.length !== 2) throw new CustomError('Wrong syntax: !9kmmrbot emotes del emotes, hero');
        const emotesList = split[0].split(' ');
        const { emotesets } = twitch;
        const emotesetsKeys = Object.keys(emotesets);
        const resultEmotes = [];
        const resultEmoteSets = [];
        for (let i = 0; i < emotesList.length; i += 1) {
          let found = false;
          for (let j = 0; j < emotesetsKeys.length && !found; j += 1) {
            const foundemote = emotesets[emotesetsKeys[j]].find((emote: {
              code: string;
            }) => emote.code === emotesList[i]);
            if (foundemote) {
              resultEmotes.push(foundemote.id);
              resultEmoteSets.push(emotesetsKeys[j]);
              found = true;
            }
          }
          if (!found) throw new CustomError(`Emote ${emotesList[i]} wasn't found on the bot`);
        }
        const heroQuery = await db.collection('heroes').findOne({ $or: [{ custom: false }, { custom: { $exists: false } }], localized_name: { $regex: split[1], $options: 'i' } });
        if (!heroQuery) throw new CustomError(`Hero ${split[1]} doesn't exist`);
        db.collection('heroes').deleteOne({
          id: heroQuery.id, custom: true, emotes: resultEmotes, emotesets: resultEmoteSets,
        });
        return `Emotes ${emotesList.join(' ')} deleted as custom emote for hero ${heroQuery.localized_name}`;
      }
      return '';
    case 'listemotes':
      if (!userDocument?.globalMod) return '';
      if (args.length === 1) {
        const heroesQuery: { custom?: boolean, localized_name?: string, id: number, emotes: number[], emotesets: string[] }[] = await db.collection('heroes').find().toArray();
        const emotes: { [key: string]: string[] } = {};
        const { emotesets } = twitch;
        for (let i = 0; i < heroesQuery.length; i += 1) {
          if (heroesQuery[i].custom) {
            let found = true;
            const heroEmotes: string[] = [];
            for (let j = 0; j < heroesQuery[i].emotes.length && found; j += 1) {
              const foundEmote = emotesets[heroesQuery[i].emotesets[j]]?.find((emote: {
                id: number;
              }) => emote.id === heroesQuery[i].emotes[j]);
              if (foundEmote) {
                heroEmotes.push(foundEmote.code);
              } else {
                found = false;
              }
            }
            if (found) {
              const realHero = heroesQuery.find((hero) => !hero.custom
                && hero.id === heroesQuery[i].id);
              if (realHero) {
                if (!emotes[realHero.localized_name as string]) emotes[realHero.localized_name as string] = [];
                emotes[realHero.localized_name as string].push(heroEmotes.join(' '));
              }
            }
          }
        }
        const keys = Object.keys(emotes);
        const temp = [];
        for (let i = 0; i < keys.length; i += 1) {
          temp.push(`${keys[i]}: ${emotes[keys[i]].join(', ')}`);
        }
        return temp.join(', ');
      }
      return '';
    case 'addglobalnp':
      if (!userDocument?.globalMod) return '';
      if (args.length > 2) {
        const id = returnAccountId(args[1]);
        if (Number.isNaN(id)) {
          throw new CustomError('Wrong syntax: !9kmmrbot addglobalnp id nickname');
        } else {
          try {
            await db.collection('notablePlayers').updateOne({ id, channel: { $exists: false } }, {
              $set: {
                id, name: args.slice(2).join(' '), enabled: true, lastChanged: new Date(), lastChangedBy: userId,
              },
            }, { upsert: true });
            return `${tags.username} successfully added ${id} to global notable players`;
          } catch (err) {
            throw new CustomError(`Error adding ${id} to global notable players`);
          }
        }
      } else {
        throw new CustomError('Wrong syntax: !9kmmrbot addglobalnp id nickname');
      }
    case 'delglobalnp':
      if (!userDocument?.globalMod) return '';
      if (args.length === 2) {
        const id = returnAccountId(args[1]);
        if (Number.isNaN(id)) {
          throw new CustomError('Wrong syntax: !9kmmrbot delglobalnp id');
        } else {
          try {
            await db.collection('notablePlayers').updateOne({ id, channel: { $exists: false } }, {
              $set: {
                id, enabled: false, lastChanged: new Date(), lastChangedBy: userId,
              },
            });
            return `${tags.username} successfully removed ${id} from global notable players`;
          } catch (err) {
            throw new CustomError(`Error removing ${id} from global notable players`);
          }
        }
      } else {
        throw new CustomError('Wrong syntax: !9kmmrbot delglobalnp id');
      }
    case 'join':
      if (!userDocument?.globalMod) return '';
      if (args.length > 1 && (/^[a-zA-Z0-9][\w]{0,24}$/).test(args[1])) {
        const { data: [user] } = await Twitch.api('users', { login: args[1] });
        twitch.join(args[1]).catch(() => { });
        db.collection('channels').updateOne({ id: Number(user.id) }, { $set: { name: args[1] } }, { upsert: true });
        return `Joining ${args[1]}`;
      }
      return '';
    case 'part':
      if (!userDocument?.globalMod) return '';
      if (args.length > 1 && (/^[a-zA-Z0-9][\w]{0,24}$/).test(args[1])) {
        const { data: [user] } = await Twitch.api('users', { login: args[1] });
        twitch.join(args[1]).catch(() => { });
        db.collection('channels').updateOne({ id: Number(user.id) }, { $unset: { name: '' } }, { upsert: true });
        return `Leaving ${args[1]}`;
      }
      break;
    case 'refresh':
      if (!userDocument?.globalMod) return '';
      command.refreshCommands();
      return 'Refreshed commands';
    default:
      return '';
  }
  return '';
}
